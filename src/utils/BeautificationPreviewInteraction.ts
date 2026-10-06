// Fixed, local-only controls for the theme fixture. No host bridge, storage or network calls.
// This script receives its own CSP nonce; author scripts still require the preview policy.
export const BEAUTIFICATION_PREVIEW_INTERACTION = String.raw`(() => {
  const drawers = [...document.querySelectorAll('#top-settings-holder > .drawer')];
  const setDrawer = (drawer, open) => {
    const button = drawer.querySelector('.drawer-icon');
    const panel = drawer.querySelector('.drawer-content');
    button.classList.toggle('openIcon', open);
    button.classList.toggle('closedIcon', !open);
    button.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('openDrawer', open);
    panel.classList.toggle('closedDrawer', !open);
    panel.inert = !open;
  };
  const toggleDrawer = drawer => {
    const open = !drawer.querySelector('.drawer-content').classList.contains('openDrawer');
    drawers.forEach(item => setDrawer(item, item === drawer && open));
  };
  document.getElementById('extensionsMenuButton').addEventListener('click', () => toggleDrawer(document.getElementById('extensions-settings-button')));
  drawers.forEach(drawer => {
    drawer.querySelector('.drawer-icon').addEventListener('click', () => toggleDrawer(drawer));
    drawer.querySelector('[data-close-drawer]').addEventListener('click', () => {
      setDrawer(drawer, false);
      drawer.querySelector('.drawer-icon').focus();
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = drawers.find(drawer => drawer.querySelector('.openDrawer'));
    if (open) {
      setDrawer(open, false);
      open.querySelector('.drawer-icon').focus();
    }
  });
  const filter = (inputId, selector) => {
    document.getElementById(inputId).addEventListener('input', event => {
      const query = event.target.value.trim().toLocaleLowerCase();
      document.querySelectorAll(selector).forEach(item => {
        item.hidden = !item.textContent.toLocaleLowerCase().includes(query);
      });
    });
  };
  filter('character_search_bar', '.character_select');
  filter('bg-filter', '.bg_example');
  document.querySelectorAll('.bg_example').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.bg_example').forEach(item => {
        item.classList.toggle('selected', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      document.getElementById('bg1').style.background = button.dataset.background;
    });
  });
  document.querySelectorAll('.persona-card').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.persona-card').forEach(item => {
        item.classList.toggle('selected', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      document.getElementById('your_name').value = button.textContent;
    });
  });
  const settings = [['font_scale', '--fontScale'], ['blur_strength', '--blurStrength'], ['chat_width', '--sheldWidth'], ['shadow_width', '--shadowWidth']];
  settings.forEach(([id, variable]) => {
    const input = document.getElementById(id);
    input.value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable));
    const output = document.querySelector('output[for="' + id + '"]');
    output.value = input.value;
    input.addEventListener('input', () => {
      document.documentElement.style.setProperty(variable, input.value + (id === 'chat_width' ? 'vw' : ''));
      output.value = input.value;
    });
  });
  document.querySelectorAll('[data-body-class]').forEach(input => {
    const inverse = input.hasAttribute('data-inverse');
    input.checked = document.body.classList.contains(input.dataset.bodyClass) !== inverse;
    input.addEventListener('change', () => document.body.classList.toggle(input.dataset.bodyClass, input.checked !== inverse));
  });
  const selectMode = (id, classes) => {
    const input = document.getElementById(id);
    input.value = String(Math.max(0, classes.findIndex(name => name && document.body.classList.contains(name))));
    input.addEventListener('change', () => classes.forEach((name, index) => {
      if (name) document.body.classList.toggle(name, index === Number(input.value));
    }));
  };
  selectMode('avatar_style', ['', 'big-avatars', 'square-avatars', 'rounded-avatars']);
  selectMode('chat_display', ['', 'bubblechat', 'documentstyle']);
  document.querySelectorAll('[data-theme-color]').forEach(input => {
    const variable = input.dataset.themeColor;
    const sample = document.createElement('span');
    sample.style.color = 'var(' + variable + ')';
    document.body.append(sample);
    const channels = getComputedStyle(sample).color.match(/[\d.]+/g);
    sample.remove();
    if (channels && channels.length >= 3) input.value = '#' + channels.slice(0, 3).map(value => Math.round(Number(value)).toString(16).padStart(2, '0')).join('');
    input.addEventListener('input', () => document.documentElement.style.setProperty(variable, input.value));
  });
  const preloader = document.getElementById('preloader');
  if (preloader) {
    const finish = () => {
      preloader.remove();
      document.getElementById('sheld').inert = false;
      document.getElementById('top-settings-holder').inert = false;
      document.body.dataset.previewScene = 'welcome';
    };
    document.getElementById('sheld').inert = true;
    document.getElementById('top-settings-holder').inert = true;
    preloader.querySelector('button').addEventListener('click', finish);
    // Observe finite authored animations, not an arbitrary timeout. Infinite spinners do not block.
    const play = () => {
      const animations = preloader.getAnimations({ subtree: true }).filter(animation => {
        const end = animation.effect.getComputedTiming().endTime;
        return Number.isFinite(end) && end > 0;
      });
      Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    };
    if (document.readyState === 'complete') play();
    else window.addEventListener('load', play, { once: true });
  }
})();`
