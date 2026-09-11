#!/bin/sh
set -eu

: "${IMAGE_TAGS:?IMAGE_TAGS is required}"
: "${IMAGE_DIGEST:?IMAGE_DIGEST is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${WORKFLOW_URL:?WORKFLOW_URL is required}"

image_tag=$(printf '%s\n' "$IMAGE_TAGS" | head -n 1)
image_name=${image_tag%:*}
candidate="$image_name@$IMAGE_DIGEST"
output=zenith-image-update
check_json=$output/check.json
mkdir -p "$output"

attempt=0
until python3 scripts/zenith-check-image.py "$candidate" > "$check_json"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 10 ]; then
        exit 1
    fi
    sleep 6
done

verified_ref=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["image"])' "$check_json")
docker_config=$(mktemp -d)
trap 'rm -rf "$docker_config"' EXIT INT TERM
DOCKER_CONFIG=$docker_config docker pull --platform linux/amd64 "$verified_ref"
DOCKER_CONFIG=$docker_config bash scripts/zenith-smoke.sh "$verified_ref"

old_ref=
if [ -f zenith-compose.yml ]; then
    old_ref=$(python3 - "$verified_ref" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path("zenith-compose.yml")
text = path.read_text()
pattern = re.compile(r"(?ms)^(  app:\n(?:(?!^  \S).)*?^    image:[ \t]*)(\S+)([ \t]*)$")
matches = list(pattern.finditer(text))
if len(matches) != 1:
    raise SystemExit("Expected exactly one image for the app service")
old = matches[0].group(2)
if not old.startswith("ghcr.io/odpay/odzip.odpay.net@sha256:"):
    raise SystemExit(f"Refusing to replace unexpected app image: {old}")
updated = pattern.sub(lambda match: match.group(1) + sys.argv[1] + match.group(3), text)
pathlib.Path("zenith-image-update/zenith-compose.yml").write_text(updated)
print(old)
PY
    )
    docker compose -f "$output/zenith-compose.yml" config --quiet
    if [ "$old_ref" != "$verified_ref" ]; then
        diff -u zenith-compose.yml "$output/zenith-compose.yml" > "$output/zenith-compose.patch" || test "$?" -eq 1
    fi
fi

VERIFIED_REF=$verified_ref OLD_REF=$old_ref python3 - <<'PY'
import json
import os
import pathlib

payload = {
    "image": os.environ["VERIFIED_REF"],
    "source_commit": os.environ["SOURCE_SHA"],
    "workflow_run": os.environ["WORKFLOW_URL"],
}
if os.environ["OLD_REF"]:
    payload["previous_image"] = os.environ["OLD_REF"]
pathlib.Path("zenith-image-update/image.json").write_text(json.dumps(payload, indent=2) + "\n")
PY

{
    echo "## Zenith image"
    echo
    echo "Verified \`$verified_ref\` for anonymous manifest, pull, linux/amd64, and application boot."
    echo "The \`zenith-image-update\` artifact contains the reviewed-update handoff."
} >> "$GITHUB_STEP_SUMMARY"
