export const base = import.meta.env.BASE_URL;

export const asset = (path: string) => `${base}${path.replace(/^\//, "")}`;

export const routerBasename = base === "/" ? "/" : base.replace(/\/$/, "");
