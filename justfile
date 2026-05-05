set shell := ["zsh", "-cu"]

default:
    @just --list

list:
    uv run --with pyyaml python abilityctl.py list

validate:
    uv run --with pyyaml python abilityctl.py validate

install ability:
    uv run --with pyyaml python abilityctl.py run {{ability}} install

dev ability:
    uv run --with pyyaml python abilityctl.py run {{ability}} dev

test ability:
    uv run --with pyyaml python abilityctl.py run {{ability}} test

build ability:
    uv run --with pyyaml python abilityctl.py run {{ability}} build

invoke ability:
    uv run --with pyyaml python abilityctl.py run {{ability}} invoke
