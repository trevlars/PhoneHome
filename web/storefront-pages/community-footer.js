/**
 * Injects community/social links into storefront footers.
 * URLs: /community-urls.json — empty string hides a platform until the account is live.
 */
(function () {
  const LABELS = {
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    youtube: "YouTube",
    reddit: "Reddit",
    discord: "Discord",
    github: "GitHub",
    discussions: "Discussions",
  };

  const ORDER = [
    "instagram",
    "facebook",
    "tiktok",
    "youtube",
    "reddit",
    "discord",
    "discussions",
    "github",
  ];

  // Discord's mark is a smiley "face" — text-only in the footer reads cleaner here.
  const TEXT_ONLY = new Set(["discord"]);

  function svgIcon(name) {
    const icons = {
      instagram:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm11.5 1.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z"/></svg>',
      facebook:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 22v-8h3l1-4h-4V7.5c0-1.2.3-2 2.2-2H17V2h-3c-3 0-4.5 1.8-4.5 5V10H7v4h2.5v8H13z"/></svg>',
      tiktok:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 3c.6 2.4 2.4 4.2 4.8 4.6V12c-2-.1-3.8-.8-5.3-2v7.4c0 3.8-3.1 6.9-6.9 6.9S2.2 20.2 2.2 16.4c0-3.5 2.6-6.4 6-6.8v4.9a2.9 2.9 0 1 0 2.1 2.8V3h6.2z"/></svg>',
      youtube:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18 5 12 5 12 5s-6 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C6 19 12 19 12 19s6 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>',
      reddit:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.7 3.3a1.4 1.4 0 0 0-1.9.5l-.9 1.8a9.4 9.4 0 0 0-4.6 0l-.9-1.8a1.4 1.4 0 1 0-2.5 1.2l.7 1.4a5.6 5.6 0 0 0-2.6 2.2 1.4 1.4 0 1 0 2.4 1.4 2.8 2.8 0 0 1 4.8 0 1.4 1.4 0 1 0 2.4-1.4 5.6 5.6 0 0 0-2.6-2.2l.7-1.4a1.4 1.4 0 0 0-.5-1.9zM9 12.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm5.2 3.4a4.8 4.8 0 0 1-4.4 0 1.4 1.4 0 0 0-1.4 2.4 7.6 7.6 0 0 0 7.2 0 1.4 1.4 0 1 0-1.4-2.4zM15 12.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zM5.2 14.8A1.4 1.4 0 0 0 3.6 16a7.2 7.2 0 0 0 1.2 2.6 1.4 1.4 0 0 0 2.4-1.4 4.4 4.4 0 0 1-.8-1.4 1.4 1.4 0 0 0-.2-1zm13.6 0a1.4 1.4 0 0 0-.2 1 4.4 4.4 0 0 1-.8 1.4 1.4 1.4 0 0 0 2.4 1.4 7.2 7.2 0 0 0 1.2-2.6 1.4 1.4 0 0 0-1.6-1.4z"/></svg>',
      discord:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.27 5.33C17.72 4.71 16.09 4.27 14.38 4c-.14.25-.3.58-.41.84-1.63-.24-3.24-.24-4.84 0-.11-.26-.27-.59-.41-.84-1.7.27-3.34.71-4.89 1.33C.96 9.17.5 13.01.91 16.8c1.64 1.21 3.23 1.95 4.77 2.44.38-.53.72-1.09 1.02-1.68-.56-.21-1.1-.46-1.62-.74.14-.1.27-.21.4-.32 3.13 1.43 6.52 1.43 9.61 0 .13.11.26.22.4.32-.52.28-1.06.53-1.62.74.3.59.64 1.15 1.02 1.68 1.54-.49 3.13-1.23 4.77-2.44.48-4.39-.87-8.17-3.64-11.47zM8.68 14.7c-.97 0-1.77-.89-1.77-1.98 0-1.09.77-1.98 1.77-1.98s1.78.89 1.78 1.98c0 1.09-.8 1.98-1.78 1.98zm6.64 0c-.97 0-1.77-.89-1.77-1.98 0-1.09.77-1.98 1.77-1.98s1.78.89 1.78 1.98c0 1.09-.8 1.98-1.78 1.98z"/></svg>',
      github:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.4c.5.1.7-.2.7-.5v-1.8c-3 .7-3.6-1.4-3.6-1.4-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.7-1.4-2.4-.3-4.9-1.2-4.9-5.4 0-1.2.4-2.2 1.1-3-.1-.3-.5-1.4.1-3 0 0 .9-.3 3 1.1a10.4 10.4 0 0 1 5.4 0c2.1-1.4 3-1.1 3-1.1.6 1.6.2 2.7.1 3 .7.8 1.1 1.8 1.1 3 0 4.2-2.5 5.1-4.9 5.4.4.3.8 1 .8 2v3c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>',
      discussions:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5l-4 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4v2h12V8H6zm0 4v2h8v-2H6z"/></svg>',
    };
    return icons[name] || "";
  }

  function buildNav(urls) {
    const nav = document.createElement("nav");
    nav.className = "community-links";
    nav.setAttribute("aria-label", "Community and social");

    const heading = document.createElement("p");
    heading.className = "community-links-h";
    heading.textContent = "Community";
    nav.appendChild(heading);

    const list = document.createElement("div");
    list.className = "community-links-row";

    for (const key of ORDER) {
      const href = (urls[key] || "").trim();
      if (!href) continue;
      const a = document.createElement("a");
      a.href = href;
      a.rel = "noopener";
      a.target = "_blank";
      a.title = LABELS[key];
      a.dataset.platform = key;
      if (TEXT_ONLY.has(key)) {
        a.textContent = LABELS[key];
      } else {
        a.innerHTML = svgIcon(key);
        a.appendChild(document.createTextNode(LABELS[key]));
      }
      list.appendChild(a);
    }

    if (!list.children.length) return null;
    nav.appendChild(list);
    return nav;
  }

  function patchJsonLd(urls) {
    const sameAs = ORDER.map((k) => (urls[k] || "").trim()).filter(Boolean);
    if (!sameAs.length) return;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        if (data["@type"] === "Organization" && data.name === "PhoneHome") {
          data.sameAs = sameAs;
          script.textContent = JSON.stringify(data, null, 2);
        }
      } catch (_) {}
    }
  }

  function mount() {
    const footer = document.querySelector(".site-foot, .site-footer");
    if (!footer || footer.querySelector(".community-links")) return;

    fetch("/community-urls.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((urls) => {
        const nav = buildNav(urls);
        if (!nav) return;
        const anchor = footer.querySelector(".footer-cols, .foot-links, .footer-transparency, p");
        if (anchor) footer.insertBefore(nav, anchor);
        else footer.appendChild(nav);
        patchJsonLd(urls);
      })
      .catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
