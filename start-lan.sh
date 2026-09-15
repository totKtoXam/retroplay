#!/usr/bin/env bash
# LAN production server (retro3d.service): serves the `npm run build` output
# through wrangler/workerd on port 3001. scripts/server-deploy.sh rebuilds it.
#
# Отдаём по HTTPS, и это не про «шифрование в локальной сети». Браузер считает
# http://<ip> незащищённым источником и не отдаёт такой странице микрофон —
# совсем, даже не спрашивая разрешения. Голосовой чат в комнате (T и Y) без
# этого не работает ни у кого.
set -e
export PATH=/home/user/tools/node-v22.23.2-linux-x64/bin:/usr/local/bin:/usr/bin:/bin:$PATH
export WRANGLER_SEND_METRICS=false
cd /home/user/projects/retro3d

if [ ! -f dist/server/wrangler.json ]; then
  npm run build
fi

# Wrangler ищет .dev.vars рядом с файлом конфигурации, а не в рабочем каталоге,
# поэтому секреты из корня проекта надо принести в dist/server (scripts/sync-dev-vars.mjs).
node scripts/sync-dev-vars.mjs

# Свой сертификат, а не тот, что wrangler делает на лету: сгенерированный заново
# при каждом запуске, он заставлял бы каждого игрока заново проходить
# предупреждение браузера после любой перезагрузки сервера. Этот лежит на диске
# и живёт два года. Сертификат самоподписанный, поэтому предупреждение всё
# равно будет — но один раз на браузер.
CERT_DIR=.wrangler/lan-cert
if [ ! -f "$CERT_DIR/cert.pem" ] || [ ! -f "$CERT_DIR/key.pem" ]; then
  echo "==> Генерирую сертификат для LAN ($CERT_DIR)..."
  mkdir -p "$CERT_DIR"
  # Адреса перечислены в SAN: браузер сверяет именно их, а не поле CN.
  openssl req -x509 -newkey rsa:2048 -nodes -days 730 \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
    -subj "/CN=retro3d.lan" \
    -addext "subjectAltName=DNS:localhost,DNS:retro3d.lan,IP:127.0.0.1,IP:192.168.56.70"
fi

# --persist-to is required: by default wrangler keeps D1 next to
# dist/server/wrangler.json, i.e. in an empty database instead of the one in
# .wrangler/state that `npm run db:local` migrates.
exec npx wrangler dev --config dist/server/wrangler.json \
  --ip 0.0.0.0 --port 3001 \
  --local-protocol https \
  --https-key-path "$CERT_DIR/key.pem" \
  --https-cert-path "$CERT_DIR/cert.pem" \
  --persist-to .wrangler/state \
  --show-interactive-dev-session=false
