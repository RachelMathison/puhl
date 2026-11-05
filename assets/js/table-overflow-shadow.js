(function () {
  const wrappers = Array.from(document.querySelectorAll('.stats-table-wrapper'));
  if (!wrappers.length) return;

  function updateOverflow(wrapper) {
    const table = wrapper.querySelector('table');
    const overflows = table && table.scrollWidth > wrapper.clientWidth + 1;
    wrapper.classList.toggle('has-horizontal-overflow', Boolean(overflows));
  }

  function updateAll() {
    wrappers.forEach(updateOverflow);
  }

  wrappers.forEach(wrapper => {
    updateOverflow(wrapper);
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
