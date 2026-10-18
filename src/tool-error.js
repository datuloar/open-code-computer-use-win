export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}
