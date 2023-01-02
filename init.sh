#!/bin/sh

psql << EOF
create database "telbot";
create user telbot with login encrypted password '$DB_PASSWORD';
alter database "telbot" owner to "telbot";
grant all privileges on database "telbot" to "telbot";
EOF
