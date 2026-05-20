(function () {
  const container = document.getElementById('legs-container');
  const addBtn    = document.getElementById('add-leg');
  const tmpl      = document.getElementById('leg-template');
  const form      = document.getElementById('trade-form');
  const dialog    = document.getElementById('disclaimer-dialog');

  function addLeg(prefill) {
    const clone = tmpl.content.cloneNode(true);
    const row   = clone.querySelector('.leg-row');

    if (prefill) {
      row.querySelector('.side-select').value = prefill.side || 'BUY';
      row.querySelector('.team-select').value = prefill.team_id || '';
      row.querySelector('.qty-input').value   = prefill.quantity || 1;
      const lt = prefill.leg_type || 'cash';
      row.querySelector('.legtype-select').value = lt;
      if (lt === 'swap') {
        row.querySelector('.cash-fields').style.display = 'none';
        row.querySelector('.swap-fields').style.display = '';
        row.querySelector('.swap-team-select').value   = prefill.swap_team_id || '';
        row.querySelector('.swap-qty-input').value     = prefill.swap_quantity || 1;
      } else {
        row.querySelector('.cash-input').value = prefill.cash_amount || 0;
      }
    }

    row.querySelector('.legtype-select').addEventListener('change', function () {
      const isSwap = this.value === 'swap';
      row.querySelector('.cash-fields').style.display = isSwap ? 'none' : '';
      row.querySelector('.swap-fields').style.display = isSwap ? '' : 'none';
    });

    row.querySelector('.remove-leg').addEventListener('click', () => row.remove());

    container.appendChild(clone);
  }

  addBtn.addEventListener('click', () => addLeg());

  // Pre-fill for amend page
  if (typeof PREFILL_LEGS !== 'undefined' && PREFILL_LEGS.length) {
    PREFILL_LEGS.forEach(addLeg);
  } else {
    addLeg(); // start with one blank leg on new trade
  }

  // Disclaimer
  if (form && dialog) {
    form.addEventListener('submit', function (e) {
      if (!dialog) return;
      // Disclaimer unless every leg is BUY+cash (the only liability-free combination)
      const allBuyCash = [...form.querySelectorAll('.leg-row')].every(row => {
        return row.querySelector('.side-select').value === 'BUY' &&
               row.querySelector('.legtype-select').value === 'cash';
      });
      if (allBuyCash) return;
      e.preventDefault();
      dialog.showModal();
    });

    if (dialog) {
      dialog.addEventListener('close', function () {
        if (dialog.returnValue === 'confirm') form.submit();
      });
    }
  }
})();
