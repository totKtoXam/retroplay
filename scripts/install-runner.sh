#!/usr/bin/env bash
# Ставит на LAN-сервер свой раннер GitHub Actions для автодеплоя (.github/workflows/deploy.yml).
#
# Запуск на сервере, под пользователем сервиса (user), с токеном регистрации:
#   RUNNER_TOKEN=<токен> bash scripts/install-runner.sh
# Токен выдаёт GitHub на час: gh api -X POST repos/totKtoXam/retroplay/actions/runners/registration-token --jq .token
#
# Раннер берёт только задания с меткой retro3d-lan, а её просит один деплой после
# зелёного CI в main. Репозиторий публичный: PR из форка может переписать workflow
# и попросить эту метку, поэтому запуски для внешних участников требуют одобрения
# (Settings → Actions → Fork pull request workflows). Чужой PR не одобрять не глядя.
#
# Повторный запуск безопасен: уже настроенный раннер не трогается, сервис
# переустанавливается.

set -euo pipefail

REPO_URL="https://github.com/totKtoXam/retroplay"
VERSION="2.338.0"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_NAME="${RUNNER_NAME:-retro3d-lan}"
LABELS="retro3d-lan"

case "$(uname -m)" in
  x86_64) ARCH=x64; SHA=af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32 ;;
  aarch64) ARCH=arm64; SHA=628b4a7258487b80c1d3c221095a7ded349f5ae0175fd3dfab708d07428f041b ;;
  *) echo "Неизвестная архитектура: $(uname -m)" >&2; exit 1 ;;
esac

if [ "$(id -u)" = 0 ]; then
  echo "Запускайте под пользователем сервиса retro3d, не под root." >&2
  exit 1
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -x ./config.sh ]; then
  ARCHIVE="actions-runner-linux-$ARCH-$VERSION.tar.gz"
  echo "==> Скачиваю раннер $VERSION ($ARCH)..."
  curl -fsSL -o "$ARCHIVE" "https://github.com/actions/runner/releases/download/v$VERSION/$ARCHIVE"
  echo "$SHA  $ARCHIVE" | sha256sum -c -
  tar xzf "$ARCHIVE"
  rm "$ARCHIVE"
fi

if [ ! -f .runner ]; then
  : "${RUNNER_TOKEN:?Нужен RUNNER_TOKEN — токен регистрации (см. начало файла)}"
  echo "==> Регистрирую раннер $RUNNER_NAME с меткой $LABELS..."
  ./config.sh --unattended --url "$REPO_URL" --token "$RUNNER_TOKEN" \
    --name "$RUNNER_NAME" --labels "$LABELS" --work _work --replace
else
  echo "==> Раннер уже зарегистрирован ($(grep -o '"agentName": *"[^"]*"' .runner || echo .runner))."
fi

# Деплой перезапускает retro3d.service через `systemctl --user`. Раннер — системный
# сервис, поэтому пользовательскому systemd нужно жить и без входа в систему.
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo "==> Включаю linger для $USER (нужен sudo)..."
  sudo loginctl enable-linger "$USER"
fi

echo "==> Ставлю раннер системным сервисом (нужен sudo)..."
if sudo ./svc.sh status >/dev/null 2>&1; then sudo ./svc.sh stop || true; sudo ./svc.sh uninstall; fi
sudo ./svc.sh install "$USER"
sudo ./svc.sh start
sudo ./svc.sh status --no-pager | head -n 5

echo "==> Готово. Раннер виден в $REPO_URL/settings/actions/runners"
