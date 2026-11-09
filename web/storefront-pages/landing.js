(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const header = document.querySelector(".nav");
  const toggle = document.querySelector(".nav-toggle");
  const panel = document.querySelector("#nav-panel");

  const onScroll = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      panel.classList.toggle("is-open", !open);
    });
    panel.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        toggle.setAttribute("aria-expanded", "false");
        panel.classList.remove("is-open");
      });
    });
  }

  const reveals = [...document.querySelectorAll(".reveal")];
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach((el) => io.observe(el));

    const beats = [...document.querySelectorAll("[data-beat]")];
    const segs = [...document.querySelectorAll(".rail-seg")];
    const rail = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = beats.indexOf(visible.target);
        segs.forEach((seg, i) => seg.classList.toggle("on", i <= index));
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.6] }
    );
    beats.forEach((beat) => rail.observe(beat));
  } else {
    reveals.forEach((el) => el.classList.add("is-in"));
  }

  const stage = document.querySelector(".stage-scaler");
  const pieces = stage ? [...stage.querySelectorAll("[data-depth]")] : [];
  const hero = document.querySelector(".hero");
  const fine = window.matchMedia("(pointer: fine)").matches;
  if (!reduce && fine && hero && pieces.length) {
    hero.addEventListener("pointermove", (event) => {
      const rect = hero.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      hero.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
      hero.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
      for (const piece of pieces) {
        const depth = Number(piece.dataset.depth) || 0;
        piece.style.transform = `translate3d(${(px * depth * 22).toFixed(1)}px, ${(py * depth * 16).toFixed(1)}px, 0)`;
      }
    });
    hero.addEventListener("pointerleave", () => {
      for (const piece of pieces) piece.style.transform = "";
    });
  }
})();
