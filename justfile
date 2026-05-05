set shell := ["zsh", "-cu"]

default:
    @just --list

list:
    @find abilities -name ability.yaml | sort

notion *args='--help':
    ./bin/notion {{args}}

dashboard *args='help':
    ./bin/dashboard {{args}}
