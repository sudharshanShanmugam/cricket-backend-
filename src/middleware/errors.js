export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.join('.');
    throw new HttpError(400, where ? `${where}: ${issue.message}` : issue.message);
  }
  return result.data;
}

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err.name === 'ScoringError') return res.status(400).json({ error: err.message });
  if (err.name === 'CastError') return res.status(404).json({ error: 'Not found' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
}
