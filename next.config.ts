import type { NextConfig } from 'next';
const config: NextConfig = {
 distDir:process.env.NEXT_BUILD_DIR||'.next',
 serverExternalPackages:['@napi-rs/canvas','pdfjs-dist'],
};
export default config;
