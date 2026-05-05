#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import yaml

ROOT = Path(__file__).resolve().parent
REGISTRY_PATH = ROOT / "ability-registry.yaml"
ALLOWED_TYPES = {"connector", "app", "service"}
ALLOWED_RUNTIMES = {"python", "typescript"}
REQUIRED_COMMANDS = {"install", "dev", "test", "invoke"}


@dataclass
class ValidationResult:
    errors: list[str]
    warnings: list[str]


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


def load_registry() -> list[dict]:
    data = load_yaml(REGISTRY_PATH)
    abilities = data.get("abilities")
    if not isinstance(abilities, list):
        raise ValueError("ability-registry.yaml must define an 'abilities' list")
    return abilities


def iter_source_files(ability_dir: Path) -> Iterable[Path]:
    src_dir = ability_dir / "src"
    if not src_dir.exists():
        return []
    return (
        path
        for path in src_dir.rglob("*")
        if path.is_file() and path.suffix in {".py", ".ts", ".tsx", ".js", ".mjs", ".cjs"}
    )


def scan_env_usage(path: Path) -> set[str]:
    content = path.read_text(encoding="utf-8")
    patterns = [
        r'os\.getenv\(\s*["\']([A-Z0-9_]+)["\']',
        r'os\.environ\.get\(\s*["\']([A-Z0-9_]+)["\']',
        r'os\.environ\[\s*["\']([A-Z0-9_]+)["\']\s*\]',
        r'process\.env\.([A-Z0-9_]+)\b',
        r'process\.env\[\s*["\']([A-Z0-9_]+)["\']\s*\]',
    ]
    matches: set[str] = set()
    for pattern in patterns:
        matches.update(re.findall(pattern, content))
    return matches


def resolve_command_executable(command: str) -> str | None:
    parts = shlex.split(command)
    for part in parts:
        if "=" in part and not part.startswith(("/", "./")) and part.index("=") > 0:
            key = part.split("=", 1)[0]
            if key.replace("_", "").isalnum():
                continue
        return part
    return None


def validate_manifest(entry: dict) -> ValidationResult:
    errors: list[str] = []
    warnings: list[str] = []
    manifest_path = ROOT / entry["manifest"]

    if not manifest_path.exists():
        return ValidationResult(
            errors=[f"Registry entry '{entry.get('id')}' points to missing manifest {manifest_path}."],
            warnings=[],
        )

    manifest = load_yaml(manifest_path)
    ability_dir = manifest_path.parent
    required_fields = {"id", "type", "runtime", "description", "entrypoint", "env"}

    missing = sorted(required_fields - set(manifest))
    if missing:
        errors.append(f"{manifest_path}: missing required fields: {', '.join(missing)}")

    ability_id = manifest.get("id")
    if ability_id != entry.get("id"):
        errors.append(
            f"{manifest_path}: manifest id '{ability_id}' does not match registry id '{entry.get('id')}'."
        )

    ability_type = manifest.get("type")
    if ability_type not in ALLOWED_TYPES:
        errors.append(
            f"{manifest_path}: type '{ability_type}' is invalid; expected one of {sorted(ALLOWED_TYPES)}."
        )

    runtime = manifest.get("runtime")
    if runtime not in ALLOWED_RUNTIMES:
        errors.append(
            f"{manifest_path}: runtime '{runtime}' is invalid; expected one of {sorted(ALLOWED_RUNTIMES)}."
        )

    env_vars = manifest.get("env")
    if not isinstance(env_vars, list) or not all(isinstance(item, str) for item in env_vars):
        errors.append(f"{manifest_path}: env must be a list of strings.")
        env_vars = []

    commands = manifest.get("commands")
    if not isinstance(commands, dict):
        errors.append(f"{manifest_path}: commands must be a mapping.")
        commands = {}

    missing_commands = sorted(REQUIRED_COMMANDS - set(commands))
    if missing_commands:
        errors.append(f"{manifest_path}: missing lifecycle commands: {', '.join(missing_commands)}")

    entrypoint = manifest.get("entrypoint")
    if commands.get("invoke") and entrypoint != commands["invoke"]:
        errors.append(f"{manifest_path}: entrypoint must exactly match commands.invoke.")

    executable_commands = [entrypoint] if isinstance(entrypoint, str) else []
    executable_commands.extend(value for value in commands.values() if isinstance(value, str))
    for command in executable_commands:
        executable = resolve_command_executable(command)
        if executable and shutil.which(executable) is None:
            errors.append(
                f"{manifest_path}: command '{command}' references missing executable '{executable}'."
            )

    src_dir = ability_dir / "src"
    if not src_dir.exists():
        errors.append(f"{manifest_path}: ability must include a src/ directory.")

    used_env: set[str] = set()
    for source_path in iter_source_files(ability_dir):
        used_env.update(scan_env_usage(source_path))

    undeclared = sorted(used_env - set(env_vars))
    if undeclared:
        errors.append(
            f"{manifest_path}: source files use undeclared env vars: {', '.join(undeclared)}"
        )

    unused = sorted(set(env_vars) - used_env)
    if unused:
        warnings.append(
            f"{manifest_path}: declared env vars are not referenced in src/: {', '.join(unused)}"
        )

    return ValidationResult(errors=errors, warnings=warnings)


def get_ability_entry(ability_id: str) -> tuple[dict, dict]:
    for entry in load_registry():
        if entry.get("id") == ability_id:
            manifest_path = ROOT / entry["manifest"]
            return entry, load_yaml(manifest_path)
    raise ValueError(f"Unknown ability '{ability_id}'.")


def cmd_list() -> int:
    for entry in load_registry():
        manifest = load_yaml(ROOT / entry["manifest"])
        print(
            f"{manifest['id']}\t{manifest['type']}\t{manifest['runtime']}\t{manifest['description']}"
        )
    return 0


def cmd_validate() -> int:
    all_errors: list[str] = []
    all_warnings: list[str] = []
    seen_ids: set[str] = set()

    for entry in load_registry():
        ability_id = entry.get("id")
        if ability_id in seen_ids:
            all_errors.append(f"ability-registry.yaml: duplicate ability id '{ability_id}'.")
            continue
        seen_ids.add(ability_id)

        result = validate_manifest(entry)
        all_errors.extend(result.errors)
        all_warnings.extend(result.warnings)

    for warning in all_warnings:
        print(f"WARNING: {warning}")
    for error in all_errors:
        print(f"ERROR: {error}")

    if all_errors:
        print(f"Validation failed with {len(all_errors)} error(s).")
        return 1

    print(f"Validated {len(seen_ids)} abilities successfully.")
    return 0


def cmd_run(ability_id: str, command_name: str) -> int:
    _, manifest = get_ability_entry(ability_id)
    commands = manifest.get("commands", {})
    if command_name not in commands:
        raise ValueError(
            f"Ability '{ability_id}' does not define command '{command_name}'. Available: {sorted(commands)}"
        )

    command = commands[command_name]
    print(f"Running {ability_id}:{command_name}")
    completed = subprocess.run(command, cwd=ROOT, shell=True, check=False)
    return completed.returncode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Hermes ability control plane.")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    subparsers.add_parser("list", help="List discoverable abilities.")
    subparsers.add_parser("validate", help="Validate the registry and ability manifests.")

    run_parser = subparsers.add_parser("run", help="Run a lifecycle command for an ability.")
    run_parser.add_argument("ability_id")
    run_parser.add_argument("command_name")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.subcommand == "list":
            return cmd_list()
        if args.subcommand == "validate":
            return cmd_validate()
        if args.subcommand == "run":
            return cmd_run(args.ability_id, args.command_name)
    except (ValueError, FileNotFoundError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
