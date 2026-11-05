// Nest a grid inside a cell (e.g. two columns inside a pop-up).  { type: 'stack', span: 6, cols: 12, cards: [...] }
export default (cfg, ctx) => ctx.grid(cfg.cards, cfg.cols || 12, ctx.home);
