// The largest broker's statement the Portfolio's import accepts. Vercel refuses a request body over 4.5 MB before
// the server action runs, so the limit stays under it, with room for the form's own bytes; a 145-page statement is
// 1.6 MB. The import checks it in the browser too, so a bigger file gets this message instead of a failed upload.
export const MAX_STATEMENT_BYTES = 4 * 1024 * 1024;
export const STATEMENT_TOO_BIG = "That file is over 4 MB, much bigger than a statement.";
