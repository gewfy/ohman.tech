import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import type { SchemaContext } from 'astro:content';

/**
 * A photograph in a gallery band. `layout` decides how wide the tile sits in
 * the three column grid: `tall` takes one column, `wide` two, and two
 * consecutive `half` shots share one column as a stack. Video embeds use the
 * same field, plus `full` for a 16:9 row.
 *
 * `caption` is the image text: plain in `alt`, markup in the viewer so a
 * photo credit can link out.
 */
const layout = z.enum(['tall', 'wide', 'half', 'full']);

const shot = ({ image }: SchemaContext) =>
  z.object({
    src: image(),
    caption: z.string().optional(),
    layout: z.enum(['tall', 'wide', 'half']).default('tall')
  });

/** A YouTube or Vimeo embed that sits in the gallery grid like a photograph. */
const film = z.object({
  provider: z.enum(['youtube', 'vimeo']),
  id: z.string(),
  title: z.string(),
  /** `full` is the whole row at 16:9; the others match photograph tiles. */
  layout: layout.default('full')
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: (ctx) =>
    z.object({
      /** Plain title for meta tags and the homepage link label */
      title: z.string(),
      /** The same title broken into the lines the hero should set */
      titleLines: z.array(z.string()),
      /** Sort order on the homepage, lowest first. Unused when `hidden`. */
      order: z.number(),
      description: z.string(),

      /**
       * Unlisted: still built at /{slug}, omitted from the homepage and
       * sitemap. Teaser is unused and may be omitted.
       */
      hidden: z.boolean().default(false),

      teaser: z
        .object({
          src: ctx.image(),
          alt: z.string(),
          text: z.string(),
          tags: z.array(z.string())
        })
        .optional(),

      /** Opening pull quote, borrowed from press or a collaborator */
      quote: z
        .object({
          text: z.string(),
          cite: z.string(),
          href: z.url().optional()
        })
        .optional(),

      lead: shot(ctx),
      facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
      gallery: z.array(z.union([shot(ctx), film])).default([]),

      /** Footnotes after the photographs. Inline HTML allowed for links. */
      notes: z.array(z.string()).default([])
    })
    .superRefine((data, ctx) => {
      if (!data.hidden && !data.teaser) {
        ctx.addIssue({
          code: 'custom',
          message: 'teaser is required unless the project is hidden',
          path: ['teaser']
        });
      }
    })
});

export const collections = { projects };
