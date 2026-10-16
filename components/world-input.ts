import type { Dispatch, SetStateAction } from 'react';
import * as T from 'three';
import { GAME_TOOLS, type Room } from '@/lib/model';
import { slotForDigit, cycleSlot } from '@/lib/loadout';
import { modeOf } from '@/lib/maps/catalog';
import { createMoveFilter } from '@/lib/mouse-filter';
import { POINTER_RELOCK_WINDOW_MS, inRelockWindow } from '@/lib/hud-feedback';
import { wrapAngle, type Perspective } from '@/lib/game-camera';
import { GRENADE_COOLDOWN_MS } from '@/lib/weapon-definition';
import type { WeaponAimModes } from '@/lib/aim-settings';
import type { VoiceChannel } from './voice-chat';
import type { WeaponPrediction } from '@/lib/weapon-prediction';
import type { WorldKit } from './world-map-scene';
import { SNIPER_ZOOM_LEVELS } from './world-constants';
import type { createFirstPersonHands } from './world-hands';
import type { createWorldPlayer } from './world-player';
import type { createFootsteps } from './world-footsteps';
import type { createWeaponSounds } from './world-weapon-sounds';
import type { createFlashlightBeam, createPlayerFlashlight } from './world-flashlight';

/**
 * Клавиатура и мышь движка мира: захват мыши (с повтором сразу после Esc и
 * обзором зажатой кнопкой, когда захват недоступен), клавиши, колесо,
 * кнопки мыши, табло по «Ё» и сброс ввода (`clear`).
 *
 * Вынесено из движка в world.tsx дословно. Слушатели вешаются при создании
 * и снимаются в `dispose()`. Флаги, которые делят ввод, кадр и оружие
 * (`middle`, `aimHeld`, `softLook`…), остаются переменными движка — сюда
 * они приходят объектом `state` с геттерами и сеттерами на те же переменные.
 * Своё у ввода — обзор зажатой кнопкой, фильтр скачков мыши и попытки захвата.
 */
export function createWorldInput({
  canvas,
  latest,
  engine,
  keys,
  mouse,
  ray,
  camera,
  kit,
  player,
  hands,
  magazine,
  selection,
  state,
  disposed,
  isDead,
  footsteps,
  weaponSounds,
  weaponVolume,
  flashlight,
  localBeam,
  trajectoryLine,
  landingMarker,
  shoot,
  beginReload,
  reloadingFeedback,
  scoreHeldRef,
  scorePinnedRef,
  tabletInWorldRef,
  sniperZoomIndexRef,
  aimModesRef,
  perspectiveRef,
  openTabletInWorld,
  closeTabletInWorld,
  choosePerspective,
  setActive,
  setPlayed,
  setLocked,
  setCaptureError,
  setCaptureWait,
  setAiming,
  setRadial,
  setContextWheel,
  setScorePinned,
  setMapExpanded,
  setSniperZoomIndex,
}: {
  canvas: HTMLCanvasElement;
  latest: {
    readonly current: {
      room: Room;
      tool: number;
      blocked: boolean;
      sensitivity: number;
      invertCamera: boolean;
      onTool: (n: number) => void;
      onUseTool: (zone: string) => void;
      onAction: (kind: string) => void;
      onMonitor: (v: boolean) => void;
      onTalk?: (channel: VoiceChannel, on: boolean) => void;
    };
  };
  /** Методы движка: снаряжение, пауза, камера. */
  engine: {
    readonly current: {
      closeInventory: (resume?: boolean) => void;
      openInventory: () => void;
      openContext: () => void;
      pause: () => void;
      reset: () => void;
      distance: (delta: number) => void;
    } | null;
  };
  /** Зажатые клавиши: их читает игрок (world-player.ts). */
  keys: Set<string>;
  /** Курсор в координатах экрана −1…1: пишется здесь, им целятся без захвата мыши. */
  mouse: T.Vector2;
  /** Общий луч движка. */
  ray: T.Raycaster;
  camera: T.Camera;
  kit: WorldKit;
  player: ReturnType<typeof createWorldPlayer>;
  hands: ReturnType<typeof createFirstPersonHands>;
  magazine: { readonly current: WeaponPrediction['magazine'] };
  selection: { readonly current: { tabletZone: string } };
  /** Общие с кадром и оружием переменные движка (геттеры и сеттеры). */
  state: {
    middle: boolean;
    left: boolean;
    aimHeld: boolean;
    softLook: boolean;
    activeControl: boolean;
    grenadeAiming: boolean;
    continuousShots: number;
    flashlightOn: boolean;
    readonly nearZone: string;
    readonly lastGrenade: number;
  };
  /** Движок разобран: отложенный повтор захвата мыши уже не нужен. */
  disposed: () => boolean;
  isDead: () => boolean;
  footsteps: ReturnType<typeof createFootsteps>;
  weaponSounds: ReturnType<typeof createWeaponSounds>;
  weaponVolume: () => number;
  flashlight: ReturnType<typeof createPlayerFlashlight>;
  localBeam: ReturnType<typeof createFlashlightBeam>;
  /** Линия и метка прицела гранаты (world-grenade-aim.ts). */
  trajectoryLine: T.Object3D;
  landingMarker: T.Object3D;
  shoot: () => void;
  beginReload: () => void;
  reloadingFeedback: () => void;
  scoreHeldRef: { current: boolean };
  scorePinnedRef: { current: boolean };
  tabletInWorldRef: { readonly current: boolean };
  sniperZoomIndexRef: { readonly current: number };
  aimModesRef: { readonly current: WeaponAimModes };
  perspectiveRef: { readonly current: Perspective };
  openTabletInWorld: () => void;
  closeTabletInWorld: () => void;
  choosePerspective: (value: Perspective) => void;
  setActive: (active: boolean) => void;
  setPlayed: (played: boolean) => void;
  setLocked: (locked: boolean) => void;
  setCaptureError: (error: string) => void;
  setCaptureWait: (waiting: boolean) => void;
  setAiming: (aiming: boolean) => void;
  setRadial: (open: boolean) => void;
  setContextWheel: (open: boolean) => void;
  setScorePinned: (pinned: boolean) => void;
  setMapExpanded: Dispatch<SetStateAction<boolean>>;
  setSniperZoomIndex: Dispatch<SetStateAction<number>>;
}) {
  // Кнопка мыши зажата: единственный способ осмотреться, когда захват
  // мыши недоступен (обзор по краям экрана убран — он уводил камеру сам).
  let dragLook = false,
    // Первое движение после захвата мыши браузер отдаёт скачком.
    skipNextMove = false;
  const moveFilter = createMoveFilter();
  /** Когда игрок вышел из захвата мыши (performance.now()). */
  let pointerExitAt = -Infinity;
  let relockTimer = 0;
  let lockAttempt = 0;
  /** Неудача текущей попытки захвата — её же зовёт событие pointerlockerror. */
  let lockFailed: (() => void) | null = null;
  const capture = () => {
    // Клик по миру — жест игрока: теперь браузер разрешит звук шагов.
    footsteps.resume();
    weaponSounds.resume();
    if (latest.current.blocked || document.pointerLockElement === canvas)
      return;
    canvas.focus();
    setCaptureError('');
    clearTimeout(relockTimer);
    const fallback = () => {
      state.softLook = true;
      state.activeControl = true;
      setActive(true);
      setPlayed(true);
      setCaptureError(
        'Захват мыши недоступен · зажмите кнопку мыши, чтобы осмотреться · Esc — курсор',
      );
    };
    /*
     * Сразу после Esc браузер около секунды отказывает в захвате мыши. Это не
     * «захват недоступен», а пауза: в первые полторы секунды после выхода
     * просим секунду и повторяем попытку сами — клик ещё считается жестом
     * игрока. Не вышло и со второго раза — тогда уже обзор зажатой кнопкой.
     */
    const attempt = (retried: boolean) => {
      const id = ++lockAttempt;
      const failed = () => {
        if (id !== lockAttempt || disposed() || document.pointerLockElement === canvas) return;
        lockAttempt++;
        const now = performance.now();
        if (!retried && inRelockWindow(pointerExitAt, now)) {
          setCaptureWait(true);
          relockTimer = window.setTimeout(
            () => {
              if (!disposed() && !latest.current.blocked) attempt(true);
              else setCaptureWait(false);
            },
            Math.max(200, pointerExitAt + POINTER_RELOCK_WINDOW_MS - now),
          );
          return;
        }
        setCaptureWait(false);
        fallback();
      };
      lockFailed = failed;
      skipNextMove = true;
      try {
        if (!canvas.requestPointerLock)
          throw new Error('Захват мыши недоступен');
        const result = canvas.requestPointerLock();
        void Promise.resolve(result).catch(failed);
      } catch {
        failed();
      }
    };
    attempt(false);
  };
  const enabled = () =>
    document.pointerLockElement === canvas ||
    (state.activeControl &&
      !(document.activeElement as HTMLElement | null)?.closest(
        'input,textarea,select,[role=dialog],[role=combobox],[role=listbox],[role=menu]',
      ));
  const clear = () => {
    keys.clear();
    state.left = false;
    state.continuousShots = 0;
    if (state.grenadeAiming) {
      state.grenadeAiming = false;
      trajectoryLine.visible = false;
      landingMarker.visible = false;
    }
    state.aimHeld = false;
    setAiming(false);
    player.releaseCrouch();
  };
  // Табло счёта: удержание «ё» — показать, ЛКМ при зажатой «ё» — залипание.
  const releaseScoreHold = () => {
    if (!scoreHeldRef.current) return;
    scoreHeldRef.current = false;
    if (!scorePinnedRef.current) latest.current.onMonitor(false);
  };
  const pinScore = () => {
    scoreHeldRef.current = false;
    scorePinnedRef.current = true;
    setScorePinned(true);
    latest.current.onMonitor(true);
    // Единственное место, кроме Esc, где курсор освобождается намеренно:
    // по табло надо кликать (например сменить сторону).
    if (document.pointerLockElement) document.exitPointerLock();
    state.softLook = false;
    state.activeControl = false;
    setActive(false);
    clear();
  };
  const closeScore = () => {
    scoreHeldRef.current = false;
    scorePinnedRef.current = false;
    setScorePinned(false);
    latest.current.onMonitor(false);
  };
  const onBlur = () => {
    // Окно потеряло фокус — keyup по «ё» не придёт, табло зависло бы открытым.
    releaseScoreHold();
    clear();
  };
  const onKey = (e: KeyboardEvent) => {
    // Сочетания с Ctrl / Alt / Cmd принадлежат браузеру и системе: Ctrl+W
    // закрывает вкладку, Ctrl+T открывает новую, Ctrl+R перезагружает,
    // Alt+F4 закрывает окно. Перехватить их со страницы нельзя, поэтому
    // игра на них просто не реагирует — иначе служебная комбинация вдобавок
    // дёргала бы игрока. Игровые клавиши работают только без модификаторов.
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (
      (e.code === 'KeyQ' || e.code === 'KeyI') &&
      !e.repeat &&
      !latest.current.blocked &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !(e.target as HTMLElement | null)?.closest(
        'input,textarea,select,[contenteditable=true]',
      )
    ) {
      e.preventDefault();
      if (state.middle) {
        engine.current?.closeInventory();
      } else {
        engine.current?.openInventory();
      }
      return;
    }
    if (e.code === 'Escape') {
      if (scorePinnedRef.current || scoreHeldRef.current) {
        const wasPinned = scorePinnedRef.current;
        closeScore();
        // Залипшее табло Esc снимает и возвращает игрока к управлению;
        // остальное (пауза, освобождение курсора) — как обычно.
        if (wasPinned) {
          e.preventDefault();
          capture();
          return;
        }
      }
      if (tabletInWorldRef.current) {
        e.preventDefault();
        closeTabletInWorld();
        return;
      }
      state.middle = false;
      setRadial(false);
      setContextWheel(false);
      engine.current?.pause();
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if ((!enabled() && !state.middle) || latest.current.blocked) return;
    if (state.middle) {
      const slot = slotForDigit(modeOf(latest.current.room.state), e.code);
      if (slot !== undefined) {
        e.preventDefault();
        latest.current.onTool(slot);
        engine.current?.closeInventory();
      }
      return;
    }
    if (
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'Space',
        'KeyC',
        'KeyX',
        'ShiftLeft',
        'ShiftRight',
        'Tab',
        'Backquote',
        'KeyE',
        'KeyF',
        'KeyV',
        'KeyR',
        'KeyZ',
        'KeyM',
        'KeyT',
        'KeyY',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        ...Array.from({ length: 10 }, (_, i) => 'Digit' + i),
      ].includes(e.code)
    )
      e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    // Удержание: табло видно, пока «ё» зажата. Нужны кнопки в табло —
    // ЛКМ при зажатой «ё» залипает (см. onDown), снимается по Esc.
    if (e.code === 'Backquote' || e.key === 'ё' || e.key === 'Ё') {
      if (
        !scorePinnedRef.current &&
        !(document.activeElement as HTMLElement | null)?.closest(
          'input,textarea,select,[contenteditable=true]',
        )
      ) {
        scoreHeldRef.current = true;
        latest.current.onMonitor(true);
      }
    }
    if (e.code === 'KeyR') beginReload();
    // План по M разворачивается и сворачивается и живым, и убитым: смотреть
    // карту в ожидании возрождения — обычное дело.
    if (e.code === 'KeyM') setMapExpanded((v) => !v);
    if (e.code === 'KeyX') player.holdCrouch();
    if (isDead()) return;
    if (e.code === 'Space') player.jump();
    if (e.code === 'KeyC') player.toggleStance(performance.now());
    if (e.code === 'KeyE' && state.nearZone) {
      // Курсор освободит сам диалог карточки (эффект на props.blocked):
      // лишний exitPointerLock здесь возвращал мышь даже без диалога.
      latest.current.onUseTool(state.nearZone);
      clear();
    }
    // F занял фонарик — привычная по шутерам клавиша, и нажимают её в бою
    // куда чаще, чем выравнивают камеру. Сброс угла обзора переехал на Z:
    // соседняя с WASD свободная клавиша, до которой дотягивается та же рука.
    // Проверка на Ctrl/Alt/Cmd выше по обработчику остаётся общей для обеих.
    if (e.code === 'KeyZ') engine.current?.reset();
    if (e.code === 'KeyF') {
      state.flashlightOn = flashlight.toggle();
      localBeam.set(state.flashlightOn && !isDead(), player.pitch);
      weaponSounds.click(state.flashlightOn, [0, 0, 0], true, weaponVolume());
    }
    if (e.code === 'KeyV')
      choosePerspective(
        perspectiveRef.current === 'first' ? 'third' : 'first',
      );
    // Рация: пока клавиша зажата, голос идёт своим (T) или всем (Y).
    // Разговор не зависит от того, жив ли игрок: мёртвому тем более есть что
    // сказать команде, и молчать в ожидании возрождения незачем.
    if (e.code === 'KeyT') latest.current.onTalk?.('team', true);
    if (e.code === 'KeyY') latest.current.onTalk?.('all', true);
    if (e.code.startsWith('Digit')) {
      const slot = slotForDigit(modeOf(latest.current.room.state), e.code);
      if (slot !== undefined) {
        latest.current.onTool(slot);
        state.aimHeld = false;
        setAiming(false);
      }
    }
  };
  const onUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    if (e.code === 'Backquote' || e.key === 'ё' || e.key === 'Ё')
      releaseScoreHold();
    // Отпускание обрабатываем и с модификаторами: иначе приседание залипло бы
    // после X + случайно нажатого Ctrl. По той же причине — и рация: зажатая
    // T плюс случайный Alt оставили бы микрофон открытым.
    if (e.code === 'KeyX') player.releaseCrouch();
    if (e.code === 'KeyT') latest.current.onTalk?.('team', false);
    if (e.code === 'KeyY') latest.current.onTalk?.('all', false);

  };
  const onMouse = (e: MouseEvent) => {
    const b = canvas.getBoundingClientRect();
    mouse.set(
      ((e.clientX - b.left) / b.width) * 2 - 1,
      (-(e.clientY - b.top) / b.height) * 2 + 1,
    );
    if (latest.current.blocked || state.middle) return;
    // Без захвата мыши камера вращается только при зажатой кнопке (drag-look):
    // прежний «обзор по краям экрана» сам уводил камеру в сторону.
    if (document.pointerLockElement === canvas || (state.softLook && dragLook)) {
      // Браузер иногда отдаёт один огромный movement — сразу после захвата
      // мыши, после сворачивания окна или скачка курсора. Такое событие
      // нужно отбросить целиком: обрезанный до предела скачок — это тот же
      // рывок камеры, только на 25° вместо 50°.
      if (skipNextMove) {
        skipNextMove = false;
        moveFilter.reset();
        return;
      }
      // Одиночный всплеск — сбой браузера, а нарастающий быстрый рывок игрока
      // проходит (lib/mouse-filter.ts).
      const move = moveFilter.filter(e.movementX, e.movementY);
      if (!move) return;
      const [mx, my] = move;
      // Scale sensitivity down when sniper is scoped
      const tool = GAME_TOOLS[latest.current.tool]?.id;
      const isSniperZoom = tool === 'sniper' && state.aimHeld;
      const zoomScale = isSniperZoom
        ? Math.max(0.12, 1 / (SNIPER_ZOOM_LEVELS[sniperZoomIndexRef.current] * 0.75))
        : 1;
      const sens = latest.current.sensitivity * zoomScale;
      const pitchBefore = player.pitch;
      player.cameraYaw = wrapAngle(player.cameraYaw - mx * 0.0023 * sens);
      player.pitch = T.MathUtils.clamp(
        player.pitch +
        my *
        0.002 *
        sens *
        (latest.current.invertCamera ? -1 : 1),
        -1.35,
        1.4,
      );
      hands.look(-mx * 0.0023 * sens, player.pitch - pitchBefore);
    }
  };
  const wheel = (e: WheelEvent) => {
    if (latest.current.blocked || state.middle || !enabled()) return;
    e.preventDefault();
    canvas.focus();
    const tool = GAME_TOOLS[latest.current.tool]?.id;
    if (tool === 'sniper' && state.aimHeld) {
      if (e.deltaY < 0) {
        setSniperZoomIndex((i) =>
          Math.min(i + 1, SNIPER_ZOOM_LEVELS.length - 1),
        );
      } else if (e.deltaY > 0) {
        setSniperZoomIndex((i) => Math.max(i - 1, 0));
      }
      return;
    }
    if (e.altKey) engine.current?.distance(e.deltaY > 0 ? 1 : -1);
    else {
      const next = cycleSlot(
        modeOf(latest.current.room.state),
        latest.current.tool,
        e.deltaY > 0 ? 1 : -1,
      );
      latest.current.onTool(next);
      state.aimHeld = false;
      setAiming(false);
    }
  };
  const onDown = (e: MouseEvent) => {
    if (latest.current.blocked || state.middle) return;
    // Залипшее табло: мимо него по миру не стреляем и захват не возвращаем —
    // выход только по Esc.
    if (scorePinnedRef.current) {
      e.preventDefault();
      return;
    }
    // «Ё» зажата и щёлкнули ЛКМ — табло остаётся на экране вместе с курсором.
    if (e.button === 0 && scoreHeldRef.current) {
      e.preventDefault();
      pinScore();
      return;
    }
    canvas.focus();
    // Пока кнопка зажата, события мыши приходят даже за пределами окна —
    // курсор больше не «выскакивает» с экрана посреди прицеливания.
    if (e.button === 0 || e.button === 2) {
      dragLook = true;
      try {
        canvas.setPointerCapture?.(
          (e as MouseEvent & { pointerId?: number }).pointerId ?? 1,
        );
      } catch {
        // Старый браузер без pointer capture: обзор всё равно работает.
      }
    }
    if (e.button === 1) {
      e.preventDefault();
      engine.current?.openContext();
    } else if (e.button === 2) {
      e.preventDefault();
      if (!enabled()) {
        capture();
        return;
      }
      const tool = GAME_TOOLS[latest.current.tool]?.id;
      if (tool === 'paint' || tool === 'confetti' || tool === 'sniper') {
        if (magazine.current.reloading) return;
        if (tool === 'sniper' && magazine.current.rounds.sniper === 0) {
          state.aimHeld = false;
          setAiming(false);
          beginReload();
          return;
        }
        const mode = aimModesRef.current[tool as keyof WeaponAimModes] || 'hold';
        if (mode === 'toggle') {
          state.aimHeld = !state.aimHeld;
        } else {
          state.aimHeld = true;
        }
        setAiming(state.aimHeld);
      }
    } else if (e.button === 0) {
      if (document.pointerLockElement !== canvas && !state.softLook) {
        capture();
        return;
      }
      state.left = true;
      const t = GAME_TOOLS[latest.current.tool]?.id;
      if (t === 'grenade') {
        // Новую гранату ещё достают: целиться нечем.
        if (performance.now() - state.lastGrenade < GRENADE_COOLDOWN_MS) {
          reloadingFeedback();
          return;
        }
        state.grenadeAiming = true;
        trajectoryLine.visible = true;
        landingMarker.visible = true;
      } else if (
        t === 'paint' ||
        t === 'confetti' ||
        t === 'sniper' ||
        t === 'like' ||
        t === 'melee'
      ) {
        shoot();
      } else if (t === 'flashlight') {
        state.flashlightOn = flashlight.toggle();
        localBeam.set(state.flashlightOn && !isDead(), player.pitch);
        weaponSounds.click(state.flashlightOn, [0, 0, 0], true, weaponVolume());
      } else if (t === 'pointer') {
        // В «Предателе» планшет — пустые руки: доска ретро в этом режиме не нужна.
        if (modeOf(latest.current.room.state) === 'impostor') return;
        if (tabletInWorldRef.current) closeTabletInWorld();
        else openTabletInWorld();
      } else if (t === 'sticky') {
        latest.current.onUseTool(selection.current.tabletZone || state.nearZone);
        clear();
      } else {
        ray.setFromCamera(
          document.pointerLockElement || state.softLook ? new T.Vector2() : mouse,
          camera,
        );
        const hit = ray.intersectObjects(kit.boards.map((b) => b.panel))[0];
        if (hit) {
          latest.current.onUseTool(hit.object.userData.zone);
          clear();
        } else if (t === 'reaction') latest.current.onAction('reaction');
        else if (state.nearZone) {
          latest.current.onUseTool(state.nearZone);
          clear();
        }
      }
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 2) {
      dragLook = false;
      try {
        canvas.releasePointerCapture?.(
          (e as MouseEvent & { pointerId?: number }).pointerId ?? 1,
        );
      } catch {
        // Захват мог не начаться — освобождать нечего.
      }
    }
    if (e.button === 0) {
      state.left = false;
      state.continuousShots = 0;
      if (state.grenadeAiming) {
        state.grenadeAiming = false;
        trajectoryLine.visible = false;
        landingMarker.visible = false;
        shoot();
      }
    }
    if (e.button === 2) {
      const tool = GAME_TOOLS[latest.current.tool]?.id;
      const mode = (tool && aimModesRef.current[tool as keyof WeaponAimModes]) || 'hold';
      if (mode === 'hold') {
        state.aimHeld = false;
        setAiming(false);
      }
    }
  };
  const changed = () => {
    const captured = document.pointerLockElement === canvas;
    state.activeControl = captured;
    setLocked(captured);
    setActive(captured);
    if (captured) {
      skipNextMove = true;
      clearTimeout(relockTimer);
      lockFailed = null;
      setCaptureWait(false);
      setPlayed(true);
    } else {
      pointerExitAt = performance.now();
      state.softLook = false;
      dragLook = false;
      clear();
    }
  };
  // Старые браузеры сообщают об отказе в захвате только событием, без промиса.
  const lockError = () => lockFailed?.();
  const context = (e: Event) => e.preventDefault();
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onUp);
  window.addEventListener('mousemove', onMouse);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', changed);
  document.addEventListener('pointerlockerror', lockError);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('contextmenu', context);
  canvas.addEventListener('auxclick', context);
  const dispose = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('mousemove', onMouse);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerlockchange', changed);
    document.removeEventListener('pointerlockerror', lockError);
    clearTimeout(relockTimer);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('contextmenu', context);
    canvas.removeEventListener('auxclick', context);
  };
  return { capture, enabled, clear, dispose };
}
