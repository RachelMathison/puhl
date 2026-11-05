(function () {
  const enhanced = new WeakMap();
  let nextId = 0;

  function decorate(select) {
    if (enhanced.has(select) || select.multiple || select.size > 1) return;

    const wrapper = document.createElement('div');
    wrapper.className = `custom-select ${select.className || ''}`.trim();
    if (select.id) wrapper.dataset.selectId = select.id;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `custom-select-trigger ${select.className || ''}`.trim();
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const associatedLabels = select.id ? [...document.querySelectorAll('label')]
      .filter(label => label.htmlFor === select.id)
      .map(label => label.textContent.trim()).filter(Boolean) : [];
    const accessibleName = select.getAttribute('aria-label') || associatedLabels.join(' ');
    if (accessibleName) trigger.setAttribute('aria-label', accessibleName);

    const label = document.createElement('span');
    label.className = 'custom-select-value';
    const arrow = document.createElement('span');
    arrow.className = 'custom-select-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    trigger.append(label, arrow);

    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.id = `custom-select-menu-${++nextId}`;
    menu.setAttribute('role', 'listbox');
    trigger.setAttribute('aria-controls', menu.id);

    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, trigger, menu);
    select.classList.add('custom-select-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    function syncSelection() {
      const selected = select.options[select.selectedIndex];
      label.textContent = selected?.textContent || '';
      trigger.disabled = select.disabled;
      menu.querySelectorAll('.custom-select-option').forEach((item, index) => {
        item.setAttribute('aria-selected', String(index === select.selectedIndex));
      });
    }

    function sync() {
      menu.replaceChildren();
      Array.from(select.options).forEach((option, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'custom-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(index === select.selectedIndex));
        item.disabled = option.disabled;
        item.dataset.index = String(index);
        item.textContent = option.textContent;
        item.addEventListener('click', () => choose(index));
        menu.append(item);
      });
      syncSelection();
    }

    function close(returnFocus = false) {
      wrapper.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    }

    function open(focusSelected = false) {
      document.querySelectorAll('.custom-select.open').forEach(other => {
        if (other !== wrapper) {
          other.classList.remove('open');
          other.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
        }
      });
      sync();
      wrapper.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      if (focusSelected) menu.querySelector('[aria-selected="true"]')?.focus();
    }

    function choose(index) {
      const option = select.options[index];
      if (!option || option.disabled) return;
      select.selectedIndex = index;
      sync();
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close(true);
    }

    trigger.addEventListener('click', () => {
      if (wrapper.classList.contains('open')) close();
      else open();
    });

    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        open(true);
      }
    });

    menu.addEventListener('keydown', event => {
      const options = [...menu.querySelectorAll('.custom-select-option:not(:disabled)')];
      const index = options.indexOf(document.activeElement);
      let target = null;
      if (event.key === 'ArrowDown') target = options[Math.min(index + 1, options.length - 1)];
      else if (event.key === 'ArrowUp') target = options[Math.max(index - 1, 0)];
      else if (event.key === 'Home') target = options[0];
      else if (event.key === 'End') target = options[options.length - 1];
      else if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      else if (event.key === 'Tab') { close(); return; }
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const active = options[index];
        if (active) choose(Number(active.dataset.index));
        return;
      } else return;
      event.preventDefault();
      target?.focus();
    });

    select.addEventListener('change', syncSelection);
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
    wrapper._syncCustomSelect = syncSelection;
    sync();
    enhanced.set(select, wrapper);

    (select.id ? document.querySelectorAll(`label[for="${CSS.escape(select.id)}"]`) : []).forEach(labelElement => {
      labelElement.addEventListener('click', event => {
        event.preventDefault();
        trigger.focus();
        open();
      });
    });
  }

  document.addEventListener('click', event => {
    if (event.target.closest('.custom-select')) return;
    document.querySelectorAll('.custom-select.open').forEach(wrapper => {
      wrapper.classList.remove('open');
      wrapper.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
    });
  });

  document.querySelectorAll('select').forEach(decorate);
  window.setInterval(() => {
    document.querySelectorAll('select').forEach(select => enhanced.get(select)?._syncCustomSelect());
  }, 300);
})();
