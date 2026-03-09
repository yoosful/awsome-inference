import {
  Certificate,
  CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
import { IHostedZone, HostedZone } from 'aws-cdk-lib/aws-route53';

import { Construct } from 'constructs';

interface CertificateResourceProps {
  domainName: string;
  apiHostName: string;
  nimHostName: string;
}

export class CertificateResources extends Construct {
  public readonly apiCertificate: Certificate;
  public readonly nimCertificate: Certificate;
  public readonly hostedZone: IHostedZone;

  constructor(scope: Construct, id: string, props: CertificateResourceProps) {
    super(scope, id);

    this.hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.domainName,
    });

    this.apiCertificate = new Certificate(this, 'ApiCertificate', {
      domainName: `${props.apiHostName}.${props.domainName}`,
      validation: CertificateValidation.fromDns(this.hostedZone),
    });

    this.nimCertificate = new Certificate(this, 'NimCertificate', {
      domainName: `${props.nimHostName}.${props.domainName}`,
      validation: CertificateValidation.fromDns(this.hostedZone),
    });
  }
}
