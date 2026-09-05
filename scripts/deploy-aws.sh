#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-2}"
FUNCTION_NAME="${FUNCTION_NAME:-procesar-imagenes-typescript}"
ROLE_NAME="${ROLE_NAME:-procesar-imagenes-lambda-role}"
WIDTH="${OUTPUT_WIDTH:-800}"
HEIGHT="${OUTPUT_HEIGHT:-600}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_ZIP="${LAMBDA_ZIP:-${SCRIPT_DIR}/lambda.zip}"
SAMPLE_IMAGE="${SAMPLE_IMAGE:-${SCRIPT_DIR}/paisaje-demo-original.jpg}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ACCOUNT_SUFFIX="${ACCOUNT_ID: -6}"
BUCKET_NAME="${SERVERLESS_BUCKET_NAME:-serverless-imagenes-greyesf1-${ACCOUNT_SUFFIX}}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"
LOG_GROUP="/aws/lambda/${FUNCTION_NAME}"

if [[ ! -f "${LAMBDA_ZIP}" ]]; then
  echo "No se encontró el paquete Lambda: ${LAMBDA_ZIP}" >&2
  exit 1
fi

if ! aws s3api head-bucket --bucket "${BUCKET_NAME}" 2>/dev/null; then
  aws s3api create-bucket \
    --bucket "${BUCKET_NAME}" \
    --region "${REGION}" \
    --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
fi

aws s3api put-public-access-block \
  --bucket "${BUCKET_NAME}" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
aws s3api put-bucket-encryption \
  --bucket "${BUCKET_NAME}" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-versioning \
  --bucket "${BUCKET_NAME}" \
  --versioning-configuration Status=Enabled

TRUST_FILE="$(mktemp)"
POLICY_FILE="$(mktemp)"
NOTIFICATION_FILE="$(mktemp)"
trap 'rm -f "${TRUST_FILE}" "${POLICY_FILE}" "${NOTIFICATION_FILE}"' EXIT

cat >"${TRUST_FILE}" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
JSON

if ! aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "file://${TRUST_FILE}" >/dev/null
  sleep 10
fi

cat >"${POLICY_FILE}" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOnlyOriginals",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/originals/*"
    },
    {
      "Sid": "WriteOnlyResized",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/resized/*"
    },
    {
      "Sid": "WriteExecutionLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:${LOG_GROUP}:*"
    }
  ]
}
JSON

aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name "procesar-imagenes-minimo" \
  --policy-document "file://${POLICY_FILE}"

aws logs create-log-group --region "${REGION}" --log-group-name "${LOG_GROUP}" 2>/dev/null || true
aws logs put-retention-policy --region "${REGION}" --log-group-name "${LOG_GROUP}" --retention-in-days 14

if aws lambda get-function --region "${REGION}" --function-name "${FUNCTION_NAME}" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --zip-file "fileb://${LAMBDA_ZIP}" >/dev/null
  aws lambda wait function-updated-v2 --region "${REGION}" --function-name "${FUNCTION_NAME}"
  aws lambda update-function-configuration \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs20.x \
    --handler index.handler \
    --role "${ROLE_ARN}" \
    --timeout 30 \
    --memory-size 512 \
    --environment "Variables={OUTPUT_WIDTH=${WIDTH},OUTPUT_HEIGHT=${HEIGHT},INPUT_PREFIX=originals/,OUTPUT_PREFIX=resized/}" >/dev/null
  aws lambda wait function-updated-v2 --region "${REGION}" --function-name "${FUNCTION_NAME}"
else
  aws lambda create-function \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs20.x \
    --handler index.handler \
    --role "${ROLE_ARN}" \
    --timeout 30 \
    --memory-size 512 \
    --environment "Variables={OUTPUT_WIDTH=${WIDTH},OUTPUT_HEIGHT=${HEIGHT},INPUT_PREFIX=originals/,OUTPUT_PREFIX=resized/}" \
    --zip-file "fileb://${LAMBDA_ZIP}" >/dev/null
  aws lambda wait function-active-v2 --region "${REGION}" --function-name "${FUNCTION_NAME}"
fi

if ! aws lambda get-policy \
  --region "${REGION}" \
  --function-name "${FUNCTION_NAME}" \
  --query 'Policy' --output text 2>/dev/null | grep -q 'PermitirInvocacionDesdeS3'; then
  aws lambda add-permission \
    --region "${REGION}" \
    --function-name "${FUNCTION_NAME}" \
    --statement-id "PermitirInvocacionDesdeS3" \
    --action lambda:InvokeFunction \
    --principal s3.amazonaws.com \
    --source-arn "arn:aws:s3:::${BUCKET_NAME}" \
    --source-account "${ACCOUNT_ID}" >/dev/null
fi

cat >"${NOTIFICATION_FILE}" <<JSON
{
  "LambdaFunctionConfigurations": [{
    "Id": "ProcesarOriginalesAutomaticamente",
    "LambdaFunctionArn": "${FUNCTION_ARN}",
    "Events": ["s3:ObjectCreated:*"],
    "Filter": {
      "Key": {
        "FilterRules": [{"Name": "prefix", "Value": "originals/"}]
      }
    }
  }]
}
JSON

aws s3api put-bucket-notification-configuration \
  --bucket "${BUCKET_NAME}" \
  --notification-configuration "file://${NOTIFICATION_FILE}"

if [[ -f "${SAMPLE_IMAGE}" ]]; then
  aws s3 cp "${SAMPLE_IMAGE}" \
    "s3://${BUCKET_NAME}/originals/paisaje-demo-original.jpg" \
    --content-type image/jpeg >/dev/null

  OUTPUT_KEY="resized/paisaje-demo-original-${WIDTH}x${HEIGHT}.jpg"
  for _ in $(seq 1 30); do
    if aws s3api head-object --bucket "${BUCKET_NAME}" --key "${OUTPUT_KEY}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  aws s3api head-object --bucket "${BUCKET_NAME}" --key "${OUTPUT_KEY}" \
    --query '{ContentType:ContentType,ContentLength:ContentLength,Metadata:Metadata}'
fi

cat <<SUMMARY

DESPLIEGUE COMPLETADO
Región: ${REGION}
Bucket: ${BUCKET_NAME}
Función: ${FUNCTION_NAME}
Entrada: s3://${BUCKET_NAME}/originals/
Salida: s3://${BUCKET_NAME}/resized/
Dimensiones: ${WIDTH}x${HEIGHT}
Logs: ${LOG_GROUP}
SUMMARY

aws logs tail "${LOG_GROUP}" --region "${REGION}" --since 10m --format short || true

