(function () {
  const wrappers = Array.from(document.querySelectorAll('.stats-table-wrapper'));
  const tabBars = Array.from(document.querySelectorAll('.stats-tabs, .stats-metric-tabs'));

  function updateOverflow(wrapper) {
    const table = wrapper.querySelector('table');
    const overflows = table && table.scrollWidth > wrapper.clientWidth + 1;
    wrapper.classList.toggle('has-horizontal-overflow', Boolean(overflows));
    if (table && table.matches('#skaters-table, #goalies-table')) {
      const numberColumn = table.querySelector('thead th:first-child');
      const stuck = Boolean(numberColumn && wrapper.scrollLeft >= numberColumn.offsetWidth);
      if (stuck !== wrapper.classList.contains('player-column-stuck')) {
        const rows = table.querySelectorAll('tbody tr');
        if (stuck && window.matchMedia('(max-width: 600px)').matches) {
          rows.forEach(row => { row.style.height = `${row.getBoundingClientRect().height}px`; });
        } else {
          rows.forEach(row => { row.style.height = ''; });
        }
        wrapper.classList.toggle('player-column-stuck', stuck);
      }
    }
  }

  function updateAll() {
    wrappers.forEach(updateOverflow);
    tabBars.forEach(updateTabs);
  }

  function updateTabs(tabs) {
    const hasMore = tabs.scrollWidth > tabs.clientWidth + 1 &&
      tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1;
    tabs.classList.toggle('has-horizontal-overflow', hasMore);
  }

  tabBars.forEach(tabs => {
    updateTabs(tabs);
    tabs.addEventListener('scroll', () => updateTabs(tabs), { passive: true });
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => updateTabs(tabs));
      observer.observe(tabs);
      Array.from(tabs.children).forEach(child => observer.observe(child));
    }
  });

  wrappers.forEach(wrapper => {
    updateOverflow(wrapper);
    wrapper.addEventListener('scroll', () => updateOverflow(wrapper), { passive: true });
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => updateOverflow(wrapper));
      observer.observe(wrapper);
      const table = wrapper.querySelector('table');
      if (table) observer.observe(table);
    }

    if (window.MutationObserver) {
      const observer = new MutationObserver(() => updateOverflow(wrapper));
      observer.observe(wrapper, { childList: true, subtree: true, characterData: true });
    }
  });

  window.addEventListener('resize', updateAll, { passive: true });
})();
