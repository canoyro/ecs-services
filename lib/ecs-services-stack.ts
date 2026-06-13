import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { EcsServices } from './constructs/ecs-services.js';

export interface EcsServicesParams {
  prefix: string;
  desiredCount?: number;
  vpcId: string;
  clusterName: string;
  bucketName: string;
  internalFileApiRepositoryUri: string;
  internalDataApiRepositoryUri: string;
  capacityProviderName: string;
}

interface EcsServicesStackProps extends cdk.StackProps {
  params: EcsServicesParams;
}

export class EcsServicesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsServicesStackProps) {
    super(scope, id, props);

    const { params } = props;

    const vpc = ec2.Vpc.fromLookup(this, 'EcsVpc', { vpcId: params.vpcId });

    const cluster = ecs.Cluster.fromClusterAttributes(this, 'EcsCluster', {
      clusterName: params.clusterName,
      vpc,
      hasEc2Capacity: true,
    });

    const bucket = s3.Bucket.fromBucketName(this, 'SharedStorageBucket', params.bucketName);

    // ECR URI format: {account}.dkr.ecr.{region}.amazonaws.com/{repoName}
    const internalApiRepository = ecr.Repository.fromRepositoryName(
      this, 'InternalFileApiRepository',
      params.internalFileApiRepositoryUri.split('/').pop()!,
    );

    const internalDataRepository = ecr.Repository.fromRepositoryName(
      this, 'InternalDataApiRepository',
      params.internalDataApiRepositoryUri.split('/').pop()!,
    );

    new EcsServices(this, 'EcsServices', {
      cluster,
      bucket,
      internalApiRepository,
      internalDataRepository,
      capacityProviderName: params.capacityProviderName,
      desiredCount: params.desiredCount ?? 1,
    });
  }
}
