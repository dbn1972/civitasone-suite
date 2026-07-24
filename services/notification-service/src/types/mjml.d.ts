declare module "mjml" {
  interface MjmlError {
    message: string;
    line?: number;
    tagName?: string;
    formattedMessage?: string;
  }

  interface MjmlResult {
    html: string;
    errors?: MjmlError[];
  }

  interface MjmlOptions {
    validationLevel?: "strict" | "soft" | "skip";
    minify?: boolean;
    filePath?: string;
  }

  function mjml2html(input: string, options?: MjmlOptions): Promise<MjmlResult>;
  export default mjml2html;
}
