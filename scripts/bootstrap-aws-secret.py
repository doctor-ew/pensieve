"""Seed the operator credential without putting its value in Terraform state or logs."""
import json
import pathlib
import sys
import boto3

source = pathlib.Path(sys.argv[1])
parameter = sys.argv[2]
if not parameter.startswith('/pensieve/'):
    raise ValueError('Use a Pensieve parameter path')
value = json.loads(source.read_text())['ownerToken']
if not isinstance(value, str) or len(value) < 32:
    raise ValueError('Invalid operator credential')
client = boto3.Session(profile_name='doctorew', region_name='us-east-1').client('ssm')
try:
    old = client.get_parameter(Name=parameter, WithDecryption=True)['Parameter']['Value']
    if old != value:
        raise ValueError('Existing credential differs; refusing to overwrite')
    print('Operator parameter already matches')
except client.exceptions.ParameterNotFound:
    client.put_parameter(Name=parameter, Type='SecureString', Value=value, Tier='Standard', Overwrite=False)
    print('Operator parameter created')
