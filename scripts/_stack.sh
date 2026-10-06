# Sourced by the other scripts. Fills in settings from the CloudFormation outputs unless they are already set,
# which is how CI passes them in as repository variables.
export AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
STACK_NAME="${STACK_NAME:-HireflowStack}"

stack_output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

need() {
  local name="$1" key="$2"
  if [[ -z "${!name:-}" ]]; then
    printf -v "$name" '%s' "$(stack_output "$key")"
    export "$name"
  fi
  [[ -n "${!name}" && "${!name}" != "None" ]] || { echo "could not work out $name (stack output $key)" >&2; exit 1; }
}
