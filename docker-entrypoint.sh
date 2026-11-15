#!/bin/sh
set -eu
mkdir -p /root/.ssh
if [ -d /host-ssh ]; then
  cp -a /host-ssh/. /root/.ssh/
fi
chown -R root:root /root/.ssh
chmod 700 /root/.ssh
find /root/.ssh -type f -name 'id_*' -exec chmod 600 {} \;
[ ! -f /root/.ssh/config ] || chmod 600 /root/.ssh/config
[ ! -f /root/.ssh/known_hosts ] || chmod 600 /root/.ssh/known_hosts
exec "$@"
