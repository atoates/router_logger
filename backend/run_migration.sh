#!/bin/bash
psql $DATABASE_URL -f database/migrations/007_add_ironwifi_tables.sql
