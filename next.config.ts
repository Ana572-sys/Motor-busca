import type { NextConfig } from 'next';
const config: NextConfig = {
 distDir:process.env.NEXT_BUILD_DIR||'.next',
 serverExternalPackages:['@napi-rs/canvas','pdfjs-dist'],
 outputFileTracingIncludes:{'/*':['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']},
};
export default config;
