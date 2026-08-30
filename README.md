# ohman.tech

The Ohman Mechatronics site: a static Astro build, deployed to GitHub Pages.
Replaces the old Tilda site, keeping its URLs.

## Running it

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
npm run preview  # serve what was built
```

`npm run assets` re-downloads the project media listed in
`scripts/assets.manifest.json`. It only fetches what is missing, so it is safe
to re-run; add `-- --force` to refetch everything. It prints each file's
dimensions and shape, which is what the gallery layouts are authored against.

## Layout of the repo

```
src/
  assets/            originals, optimised at build time by astro:assets
    home/            hero and the four homepage teasers
    projects/<slug>/ per-project photographs
  components/        Traces, Masthead, Gallery, Shot, Lightbox, Video, Contact
  content/projects/  one MDX file per project — the copy lives here
  data/site.ts       contact details, used by the footer and meta tags
  layouts/           BaseLayout (shell) and ProjectLayout (project page)
  pages/             index, [slug] for projects, 404
  scripts/           traces.js, gallery.js, masthead.js — plain DOM, no framework
  styles/            tokens.css (design tokens) and site.css
public/              favicon, touch icon, og.jpg, logo SVGs, CNAME
```

Pages are built as files rather than directories (`/puratos-sourbot`, not
`/puratos-sourbot/`), which is what the Tilda site served.

## Adding or editing a project

Each project is one file in `src/content/projects/`. The filename is the URL
slug. Frontmatter carries the structure, the MDX body carries the prose.

- `titleLines` sets the line breaks in the hero heading and the homepage teaser.
- `order` sorts the homepage, lowest first.
- `teaser` is what the homepage shows: image, alt, one paragraph, and tags.
- `quote` is the optional pull quote above the copy.
- `lead` is the photograph beside the facts, and the first image in the viewer.
- `facts` are optional label/value pairs in the middle column. Values may
  contain inline HTML, so a client name can link out. Omit the field to drop
  the spec column.
- `gallery` is the ordered list of photographs (see below).
- `video` is an optional YouTube or Vimeo embed, dropped straight into the page.
- `notes` are the footnotes under the photographs, again allowing inline HTML.

Captions appear in the full-screen viewer only, never under a tile. They may
contain a link, which is how photo credits are handled. Every caption is the
description the photograph carried on the old Tilda site, verbatim; where the
old site had none, the image goes without one and `alt` holds a plain label.

### Gallery bands

The gallery is a three-column grid read as bands. Each tile declares how many
columns it wants:

| `layout` | Takes                     | Suits              |
| -------- | ------------------------- | ------------------ |
| `tall`   | one column (default)      | portrait, square   |
| `wide`   | two columns               | landscape          |
| `half`   | half of one column        | landscape          |

Two consecutive `half` shots become a stack sharing one column, so a band adds
up to three: `wide + tall`, `tall + wide`, `tall + stack + tall`, or three
`tall`s. Tiles are cropped to the band, so pick shapes that survive it — the
`assets` script prints the shape of every file.

## Deploying

Pushing to `main` builds and publishes through
`.github/workflows/deploy.yml`. Enable it once per repository under
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

### DNS cutover from Tilda

`public/CNAME` already claims `ohman.tech`, so only DNS is left. Do it after a
build has been published and checked on the `github.io` URL.

1. In the repository, **Settings → Pages → Custom domain**, enter `ohman.tech`.
2. At the registrar, replace the Tilda records for the apex with GitHub's:

   ```
   A     @   185.199.108.153
   A     @   185.199.109.153
   A     @   185.199.110.153
   A     @   185.199.111.153
   AAAA  @   2606:50c0:8000::153
   AAAA  @   2606:50c0:8001::153
   AAAA  @   2606:50c0:8002::153
   AAAA  @   2606:50c0:8003::153
   CNAME www <account>.github.io
   ```

3. Wait for the domain check to pass, then tick **Enforce HTTPS** once the
   certificate is issued.
4. Keep the Tilda site up until then; nothing points at it after the switch.

The four project URLs are unchanged, so existing links and search results
survive: `/puratos-sourbot`, `/tiunda-school`, `/the-extruder`,
`/internet-connected-sourdough`.
