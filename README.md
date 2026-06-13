# ECS Services

CDK TypeScript stack that deploys the ECS services (task definitions, containers, auto-scaling) onto an existing cluster. Requires the [ecs-processor](https://github.com/canoyro/ecs-processor) stack to be deployed first.

## Stack Resources

- `internal-file-api` ECS service — single-value file read/write on port 8080
- `internal-data-api` ECS service — append-only JSON log on port 9090
- Both services: `desiredCount` from `parameters.json`, CPU auto-scaling (min 1 / max 2 tasks), circuit breaker with auto-rollback, 50–200% deployment health bounds
- Both containers bind-mount `/mnt/s3-shared` from the host, sharing the same S3-backed filesystem
- ECS Exec enabled on all tasks (SSM Session Manager)
- CloudWatch log group: `/ecs/<stack-name>` with 7-day retention

## Deployment Order

Deploy [ecs-processor](https://github.com/canoyro/ecs-processor) first, then fill in `parameters.json` from its CloudFormation outputs before deploying this stack.

## Parameters

Edit `parameters.json` with values from the `ecs-processor` CloudFormation outputs:

```json
{
  "prefix": "staging",
  "desiredCount": 1,
  "vpcId": "<copy from ecs-processor/parameters.json>",
  "clusterName": "<EcsClusterName output>",
  "bucketName": "<SharedStorageBucketName output>",
  "internalFileApiRepositoryUri": "<EcsInternalApiRepositoryUri output>",
  "internalDataApiRepositoryUri": "<EcsInternalDataRepositoryUri output>"
}
```

| Field | Source |
|---|---|
| `prefix` | Choose a name prefix; stack will be named `<prefix>-ecs-services-stack` |
| `desiredCount` | Number of tasks per service. Set to `0` before images are pushed. |
| `vpcId` | Copy from `ecs-processor/parameters.json` |
| `clusterName` | `EcsClusterName` CloudFormation output from `ecs-processor` |
| `bucketName` | `SharedStorageBucketName` CloudFormation output from `ecs-processor` |
| `internalFileApiRepositoryUri` | `EcsInternalApiRepositoryUri` CloudFormation output from `ecs-processor` |
| `internalDataApiRepositoryUri` | `EcsInternalDataRepositoryUri` CloudFormation output from `ecs-processor` |

To retrieve outputs from a deployed `ecs-processor` stack:

```bash
aws cloudformation describe-stacks \
  --stack-name staging-ecs-stack \
  --query "Stacks[0].Outputs" \
  --output table
```

## Deploy

```bash
npm install
npx cdk diff
npx cdk deploy
```

To scale services down without destroying them:

```bash
# Set desiredCount: 0 in parameters.json, then:
npx cdk deploy
```

## Tests

```bash
npm test
```

8 CDK assertion tests covering ECS services, task definitions, and auto-scaling.

## Test the APIs

Connect to an ECS instance via SSM Session Manager. Tasks use BRIDGE networking so they bind to host ports. Get a task's host instance IP then curl directly:

```bash
CLUSTER="staging-ecs-stack-cluster"

# Get running task details
aws ecs describe-tasks \
  --cluster "$CLUSTER" \
  --tasks $(aws ecs list-tasks --cluster "$CLUSTER" --desired-status RUNNING --query taskArns --output text) \
  --query "tasks[*].{task:taskArn,name:containers[0].name}" \
  --output table
```

### internal-file-api (port 8080)

```bash
INSTANCE_IP=<ec2-private-ip>
curl http://$INSTANCE_IP:8080/health
curl "http://$INSTANCE_IP:8080/write?value=hello"
curl http://$INSTANCE_IP:8080/read
```

`/read` from any instance returns the same value — all tasks share the same S3 mount.

### internal-data-api (port 9090)

```bash
INSTANCE_IP=<ec2-private-ip>
curl http://$INSTANCE_IP:9090/health
curl "http://$INSTANCE_IP:9090/append?message=first-entry"
curl "http://$INSTANCE_IP:9090/append?message=second-entry"
curl http://$INSTANCE_IP:9090/entries
curl http://$INSTANCE_IP:9090/clear
```

`/entries` returns the full log across all tasks — entries are appended to the shared `log.json` on S3.

## API reference

### internal-file-api

| Path | Method | Description |
|---|---|---|
| `/` | GET | Service info |
| `/health` | GET | Health check |
| `/read` | GET | Read `message.txt` from shared S3 mount |
| `/write?value=<val>` | GET | Write `message.txt` to shared S3 mount |

### internal-data-api

| Path | Method | Description |
|---|---|---|
| `/` | GET | Service info |
| `/health` | GET | Health check |
| `/entries` | GET | List all entries in `log.json` |
| `/append?message=<msg>` | GET | Append a timestamped entry to `log.json` |
| `/clear` | GET | Clear all entries in `log.json` |

## ECS Exec (shell into a running container)

```bash
CLUSTER="staging-ecs-stack-cluster"

# List running tasks
aws ecs list-tasks --cluster "$CLUSTER" --desired-status RUNNING

# Shell into a container
aws ecs execute-command \
  --cluster "$CLUSTER" \
  --task <task-id> \
  --container internal-file-api \
  --command "/bin/sh" \
  --interactive
```

## Diagnose stuck or failing tasks

```bash
CLUSTER="staging-ecs-stack-cluster"

# Service events and task counts
aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services internal-file-api internal-data-api \
  --query "services[*].{name:serviceName,running:runningCount,pending:pendingCount,events:events[0:3]}" \
  --output json

# Why did a task stop?
aws ecs describe-tasks \
  --cluster "$CLUSTER" \
  --tasks $(aws ecs list-tasks --cluster "$CLUSTER" --desired-status STOPPED --query taskArns[0] --output text) \
  --query "tasks[0].{stopped:stoppedReason,containers:containers[*].{name:name,exitCode:exitCode,reason:reason}}" \
  --output json
```
