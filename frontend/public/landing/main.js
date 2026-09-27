// HakDaar landing: mobile menu + stat count-up. No framework.
;(function () {
  'use strict'

  // ---------------------------------------------------------------- mobile menu
  var burger = document.querySelector('.burger')
  var menu = document.getElementById('mobile-menu')
  var overlay = document.querySelector('.menu-overlay')

  function setMenu(open) {
    burger.setAttribute('aria-expanded', String(open))
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
    menu.hidden = !open
    overlay.hidden = !open
    document.body.classList.toggle('menu-open', open)
    if (open) {
      var first = menu.querySelector('a')
      if (first) first.focus({ preventScroll: true })
    }
  }

  function isOpen() {
    return burger.getAttribute('aria-expanded') === 'true'
  }

  burger.addEventListener('click', function () {
    setMenu(!isOpen())
  })
  overlay.addEventListener('click', function () {
    setMenu(false)
  })
  menu.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false)
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) {
      setMenu(false)
      burger.focus()
    }
  })
  window.addEventListener('resize', function () {
    if (window.innerWidth > 720 && isOpen()) setMenu(false)
  })

  // ---------------------------------------------------------------- stat count-up
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var values = Array.prototype.slice.call(document.querySelectorAll('.stat-value'))

  function format(el, n) {
    var decimals = Number(el.dataset.decimals || 0)
    return (el.dataset.prefix || '') + n.toFixed(decimals) + (el.dataset.suffix || '')
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3)
  }

  function run(el, i) {
    var target = Number(el.dataset.target || 0)
    if (reduce) {
      el.textContent = format(el, target)
      return
    }
    var duration = 1500 + i * 80
    var startDelay = 480 + i * 90
    el.textContent = format(el, 0)
    setTimeout(function () {
      var t0 = performance.now()
      function step(now) {
        var k = Math.min(1, (now - t0) / duration)
        el.textContent = format(el, target * easeOutCubic(k))
        if (k < 1) requestAnimationFrame(step)
        else el.textContent = format(el, target)
      }
      requestAnimationFrame(step)
    }, startDelay)
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          run(entry.target, values.indexOf(entry.target))
          io.unobserve(entry.target) // count once
        })
      },
      { threshold: 0.25 }
    )
    values.forEach(function (el) {
      io.observe(el)
    })
  } else {
    values.forEach(run)
  }
})()
