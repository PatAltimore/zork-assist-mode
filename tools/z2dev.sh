#!/bin/sh
# dev helper: run a command file against zork2; print only room lines & replies compactly
SEED=${SEED:-1} node tools/play.js --game zork2 --file "$1" 2>&1
