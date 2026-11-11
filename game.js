(() => {
  'use strict';

  const { intro, spaces, encounters } = window.PAMPA;
  const byId = id => document.getElementById(id);
  const game = byId('game');
  const art = byId('scene-art');
  const previousArt = byId('scene-art-prev');
  const title = byId('scene-title');
  const copy = byId('scene-copy');
  const question = byId('scene-question');
  const action = byId('action');
  const actionLabel = byId('action-label');
  const die = byId('die');
  const dialog = byId('overlay');
  const dialogTitle = byId('overlay-title');
  const dialogCopy = byId('overlay-copy');
  const dismiss = byId('overlay-close');
  const announcer = byId('announcer');
  const sourceFor = path => window.PAMPA_ASSETS?.[path] || path;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const findStop = space => encounters.findIndex(stop => stop.space === space);
  const scenePath = index => 'assets/scene' + index + '.webp';
  const opening = [
    { title: 'A Estância do Quero-Quero', paragraphs: intro.slice(0, 2) },
    { title: 'A chama do galpão', paragraphs: intro.slice(2, 4) },
    { title: 'O lampião vazio', paragraphs: intro.slice(4, 8) },
    { title: 'Palavra de gaúcha', paragraphs: intro.slice(8) }
  ];
  const phase = { screen: 'cover', space: 1, stop: -1, stopsSeen: 0 };
  let primaryAction;
  let pendingRoll = null;
  let artKey = '';
  let artVersion = 0;
  let overlayKind = '';
  let previousOverlay = '';
  let restoreFocus = null;
  let idleHandle;
  let lastPointerAt = Date.now();
  const idleDelay = 5 * 60 * 1000;

  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value != null) element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  function writeParagraphs(element, paragraphs) {
    element.replaceChildren(...paragraphs.filter(Boolean).map(text => node('p', text)));
    element.scrollTop = 0;
  }

  function showArt(path) {
    if (path === artKey) return;
    artKey = path;
    const version = ++artVersion;
    const source = sourceFor(path);
    const next = new Image();
    next.onload = () => {
      if (version !== artVersion) return;
      if (art.getAttribute('src')) previousArt.src = art.src;
      art.classList.remove('art-enter');
      void art.offsetWidth;
      art.src = source;
      art.classList.add('art-enter');
    };
    next.src = source;
  }

  const patterns = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
  const pips = Array.from({ length: 9 }, (_, index) => {
    const pip = node('span', null, 'pip');
    pip.dataset.pip = index;
    return pip;
  });
  die.replaceChildren(...pips);

  function setDie(value) {
    die.dataset.value = value;
    pips.forEach((pip, i) => pip.classList.toggle('on', patterns[value].includes(i)));
    die.setAttribute('aria-label', 'Dado com ' + value + (value === 1 ? ' ponto' : ' pontos'));
  }

  function render(view) {
    phase.screen = view.screen;
    document.body.dataset.screen = view.screen;
    document.body.dataset.stopCount = phase.stopsSeen;
    game.style.setProperty('--stops', String(phase.stopsSeen));
    if (byId('stop-count')) byId('stop-count').textContent = phase.stopsSeen;
    byId('position').textContent = phase.screen === 'cover' ? '33 casas' : 'Casa ' + phase.space + ' de 33';
    byId('eyebrow').textContent = view.eyebrow;
    if (view.screen === 'cover') {
      title.replaceChildren(node('span', 'A Chama'), node('span', 'do Pampa'));
    } else {
      title.textContent = view.title;
    }
    writeParagraphs(copy, view.paragraphs);
    question.textContent = view.question || '';
    question.hidden = !view.question;
    actionLabel.textContent = view.label;
    action.dataset.kind = view.kind || 'next';
    action.disabled = false;
    primaryAction = view.onClick;
    die.hidden = !view.die;
    if (view.die) setDie(view.die);
    const resultPlate = byId('result-plate');
    const resultImage = byId('result-illustration');
    resultPlate.hidden = view.screen !== 'outcome';
    if (!resultPlate.hidden) {
      resultImage.src = sourceFor(view.art);
      resultImage.alt = view.title;
      showArt(scenePath(phase.stop + 2));
    } else {
      showArt(view.art);
    }
    game.classList.remove('scene-enter');
    void game.offsetWidth;
    game.classList.add('scene-enter');
    const panel = byId('scene-content') || copy.parentElement;
    panel.scrollTop = 0;
    document.querySelectorAll('.story-wrap').forEach(element => { element.scrollTop = 0; });
    if (view.screen !== 'cover') {
      announcer.textContent = [view.die ? 'Saiu ' + view.die + '.' : '', view.title].join(' ').trim();
    }
  }

  function cover() {
    Object.assign(phase, { space: 1, stop: -1, stopsSeen: 0 });
    render({
      screen: 'cover', eyebrow: 'Um lance de dados', paragraphs: ['Uma aventura da Maroca pelos pampas do Rio Grande.'],
      art: scenePath(0), label: 'Começar aventura', kind: 'start', onClick: () => showIntro(0)
    });
  }

  function showIntro(index) {
    const page = opening[index];
    const last = index === opening.length - 1;
    render({
      screen: 'intro', eyebrow: 'Prólogo · ' + (index + 1) + ' de ' + opening.length,
      title: page.title, paragraphs: page.paragraphs, art: scenePath(1),
      label: last ? 'Rolar o dado' : 'Continuar', kind: last ? 'roll' : 'next',
      onClick: last ? () => roll('move') : () => showIntro(index + 1)
    });
  }

  function moveBy(steps) {
    const nextStop = encounters.find(stop => stop.space > phase.space);
    phase.space = Math.min(phase.space + steps, nextStop ? nextStop.space : 33);
  }

  // Keep dialogue and the prompt together on short readings. Longer scenes have
  // page turns that wait for the reader, including the final fandango.
  function storyPages(stop) {
    const pages = [];
    let group = [];
    let length = 0;
    for (const paragraph of stop.story) {
      if (group.length && length + paragraph.length > 520) {
        pages.push(group);
        group = [];
        length = 0;
      }
      group.push(paragraph);
      length += paragraph.length;
    }
    if (group.length) pages.push(group);
    return pages;
  }

  function encounter(index, readPage = 0, movementDie = 0) {
    phase.stop = index;
    phase.stopsSeen = Math.max(phase.stopsSeen, Math.min(index + 1, 9));
    const stop = encounters[index];
    const pages = storyPages(stop);
    const last = readPage === pages.length - 1;
    const pageNumber = pages.length > 1 ? ' · ' + (readPage + 1) + '/' + pages.length : '';
    render({
      screen: 'encounter',
      eyebrow: (index === 9 ? 'Chegada' : 'Parada ' + (index + 1)) + ' · Casa ' + phase.space + pageNumber,
      title: stop.name, paragraphs: pages[readPage], question: last ? stop.question : '',
      art: scenePath(index + 2), die: movementDie,
      label: last ? 'Rolar o dado' : 'Continuar', kind: last ? 'roll' : 'next',
      onClick: last ? () => roll('encounter') : () => encounter(index, readPage + 1)
    });
  }

  function travel(diceValue) {
    const stopIndex = findStop(phase.space);
    if (stopIndex >= 0) {
      encounter(stopIndex, 0, diceValue);
      return;
    }
    render({
      screen: 'travel', eyebrow: 'Pampa afora · Casa ' + phase.space, title: spaces[phase.space - 1],
      paragraphs: ['Maroca e Farrapo seguem o rastro de fagulhas. Joga o dado pra continuar a viagem.'],
      art: scenePath(12), die: diceValue, label: 'Rolar o dado', kind: 'roll', onClick: () => roll('move')
    });
  }

  function homeward() {
    render({
      screen: 'travel', eyebrow: 'Casa 32 · A volta encantada', title: 'A caminho de casa',
      paragraphs: encounters[8].after, art: scenePath(10),
      label: 'Rolar o dado', kind: 'roll', onClick: () => roll('move')
    });
  }

  function victory() {
    const ending = encounters[9].after.filter(text => text !== 'FIM');
    render({
      screen: 'victory', eyebrow: 'Fim da aventura', title: 'A chama voltou!',
      paragraphs: ending, art: scenePath(11), label: 'Jogar de novo', kind: 'replay', onClick: cover
    });
  }

  function outcome(value) {
    const index = phase.stop;
    const stop = encounters[index];
    let label = 'Rolar o dado';
    let kind = 'roll';
    let onClick = () => roll('encounter');
    if (index === 8) {
      phase.space = 32;
      label = 'Voltar com a chama';
      kind = 'next';
      onClick = homeward;
    } else if (index === 9 && value > 1) {
      label = 'Celebrar com a Maroca';
      kind = 'next';
      onClick = victory;
    } else if (index < 8 && value > 1) {
      moveBy(value - 1);
      const nextIndex = findStop(phase.space);
      if (nextIndex >= 0) {
        label = 'Conhecer a parada';
        kind = 'next';
        onClick = () => encounter(nextIndex);
      } else {
        onClick = () => roll('move');
      }
    }
    const result = stop.results[value - 1];
    const landed = index < 8 && value > 1 && findStop(phase.space) >= 0;
    render({
      screen: 'outcome', eyebrow: 'Saiu ' + value + ' · ' + stop.name,
      title: stop.titles[value - 1], paragraphs: [result],
      question: landed ? 'Parada obrigatória na casa ' + phase.space + '.' : '',
      art: 'assets/results/' + (index + 1) + '-' + value + '.webp', die: value,
      label, kind, onClick
    });
  }

  function roll(mode) {
    if (pendingRoll || overlayKind || document.hidden) return;
    const value = Math.floor(Math.random() * 6) + 1;
    pendingRoll = { mode, value, remaining: reduceMotion.matches ? 140 : 900, started: null, timer: null, ticker: null };
    document.body.dataset.rolling = 'true';
    action.disabled = true;
    die.hidden = false;
    die.classList.add('rolling');
    actionLabel.textContent = 'Rolando…';
    setDie(reduceMotion.matches ? value : 1);
    resumeRoll();
  }

  function pauseRoll() {
    if (!pendingRoll || pendingRoll.started === null) return;
    clearTimeout(pendingRoll.timer);
    clearInterval(pendingRoll.ticker);
    pendingRoll.remaining = Math.max(0, pendingRoll.remaining - (performance.now() - pendingRoll.started));
    pendingRoll.started = null;
  }

  function resumeRoll() {
    if (!pendingRoll || pendingRoll.started !== null || overlayKind || document.hidden) return;
    pendingRoll.started = performance.now();
    if (!reduceMotion.matches) {
      pendingRoll.ticker = setInterval(() => setDie(1 + Number(die.dataset.value) % 6), 100);
    }
    pendingRoll.timer = setTimeout(() => {
      if (overlayKind || document.hidden) {
        pauseRoll();
        return;
      }
      const { mode, value, ticker } = pendingRoll;
      clearInterval(ticker);
      pendingRoll = null;
      die.classList.remove('rolling');
      document.body.dataset.rolling = 'false';
      if (mode === 'move') {
        moveBy(value);
        travel(value);
      } else {
        outcome(value);
      }
      action.focus({ preventScroll: true });
    }, pendingRoll.remaining);
  }

  function mapContents() {
    const grid = node('ol', null, 'map-grid');
    grid.setAttribute('aria-label', 'Trilha de 33 casas');
    spaces.forEach((name, i) => {
      const number = i + 1;
      const item = node('li', null, 'map-space');
      item.classList.toggle('stop', findStop(number) >= 0);
      item.classList.toggle('visited', number < phase.space);
      item.classList.toggle('current', number === phase.space);
      if (number === phase.space) item.setAttribute('aria-current', 'step');
      item.append(node('b', String(number)), node('span', name));
      grid.append(item);
    });
    return grid;
  }

  function presentOverlay(kind) {
    if (kind === 'idle' && overlayKind && overlayKind !== 'idle') previousOverlay = overlayKind;
    if (!overlayKind) restoreFocus = document.activeElement;
    overlayKind = kind;
    document.body.dataset.paused = 'true';
    pauseRoll();
    dialog.dataset.kind = kind;
    if (kind === 'map') {
      dialogTitle.textContent = 'O mapa do pampa';
      dialogCopy.replaceChildren(node('p', 'Maroca está na casa ' + phase.space + ' de 33. As casas vermelhas são paradas obrigatórias.'), mapContents());
    } else if (kind === 'help') {
      dialogTitle.textContent = 'Como jogar';
      const rules = [
        'Começa na Estância do Quero-Quero, na casa 1. Lê a história e toca em Rolar o dado pra seguir pela trilha.',
        'Se chegar ou passar por uma casa vermelha, a Maroca para ali. Lê o encontro e rola o dado pra descobrir o que acontece.',
        'Cada número revela uma cena. O resultado pode dar uma carona, abrir um atalho ou te convidar a jogar de novo. A próxima parada vermelha sempre segura o peão.',
        'Encontra a chama na casa 31 e leva o lampião até a festa da casa 33. Qualquer número serve pra chegar. Na festa, todo mundo ganha!'
      ];
      const list = node('ol', null, 'help-list');
      rules.forEach(rule => list.append(node('li', rule)));
      dialogCopy.replaceChildren(list, node('p', 'Jogando em bando? Um peão só, uma Maroca só. Cada criança rola o dado na sua vez.'));
    } else {
      dialogTitle.textContent = 'Uma pausa pro mate';
      writeParagraphs(dialogCopy, ['Maroca está tomando um mate. A aventura te espera aqui.']);
    }
    dismiss.textContent = kind === 'idle' ? 'Voltar da pausa' : (phase.screen === 'cover' ? 'Voltar à capa' : 'Voltar ao jogo');
    if (!dialog.open) dialog.showModal();
    dialogCopy.scrollTop = 0;
    dialog.scrollTop = 0;
    dismiss.focus({ preventScroll: true });
  }

  function closeOverlay() {
    if (!overlayKind) return;
    recordActivity();
    if (overlayKind === 'idle' && previousOverlay) {
      const returnTo = previousOverlay;
      previousOverlay = '';
      presentOverlay(returnTo);
      return;
    }
    overlayKind = '';
    dialog.close();
    document.body.dataset.paused = 'false';
    if (restoreFocus?.isConnected && !restoreFocus.disabled) restoreFocus.focus({ preventScroll: true });
    else byId('help-button').focus({ preventScroll: true });
    restoreFocus = null;
    resumeRoll();
  }

  function checkIdle() {
    clearTimeout(idleHandle);
    const remaining = idleDelay - (Date.now() - lastPointerAt);
    if (remaining <= 0) {
      if (!document.hidden && overlayKind !== 'idle') presentOverlay('idle');
      return;
    }
    idleHandle = setTimeout(checkIdle, remaining);
  }

  function recordActivity() {
    lastPointerAt = Date.now();
    clearTimeout(idleHandle);
    idleHandle = setTimeout(checkIdle, idleDelay);
  }

  action.addEventListener('click', event => {
    if (overlayKind || pendingRoll || event.detail > 1) return;
    primaryAction();
  });
  byId('help-button').addEventListener('click', () => presentOverlay('help'));
  byId('map-button').addEventListener('click', () => presentOverlay('map'));
  dismiss.addEventListener('click', closeOverlay);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeOverlay();
  });
  // Pointer events cover mice, touch and pens. Key presses also keep an
  // actively keyboard-operated game awake.
  for (const event of ['pointermove', 'pointerdown', 'keydown']) {
    window.addEventListener(event, recordActivity, { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseRoll();
    } else {
      checkIdle();
      resumeRoll();
    }
  });
  document.body.dataset.rolling = 'false';
  document.body.dataset.paused = 'false';
  cover();
  recordActivity();
})();
