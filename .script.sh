#!/bin/bash

# validate prisma schema
npx dotenv -e .env.development -- prisma validate

# generate prisma client
npx dotenv -e .env.development -- prisma generate


