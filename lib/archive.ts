import yauzl from 'yauzl';
export type ArchiveEntry={name:string;compressedBytes:number;uncompressedBytes:number;kind:'pdf'|'zip'|'office'|'other'};
export type ArchiveInventory={entries:ArchiveEntry[];requiresReview:true};
/** Inventories only; no entry is executed or extracted. Metadata is untrusted until extraction is separately validated. */
export async function inspectArchive(bytes:Uint8Array):Promise<ArchiveInventory>{
 if(bytes.byteLength>20_000_000||bytes.byteLength<4||bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('Arquivo inválido ou demasiado grande.');
 return new Promise((resolve,reject)=>yauzl.fromBuffer(Buffer.from(bytes),{lazyEntries:true,autoClose:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
  if(error||!zip){reject(new Error('Não foi possível ler o arquivo.'));return;}
  const entries:ArchiveEntry[]=[];let total=0,settled=false;
  function fail(message:string){if(settled)return;settled=true;zip!.close();reject(new Error(message));}
  zip.on('error',()=>fail('Arquivo inválido ou inseguro.'));
  zip.on('entry',entry=>{
   if(entry.fileName.endsWith('/')){zip.readEntry();return;}
   if(entries.length>=100){fail('O arquivo contém demasiados ficheiros.');return;}
   const mode=(entry.externalFileAttributes>>>16)&0xffff;
   if((mode&0o170000)===0o120000||(entry.generalPurposeBitFlag&1)!==0){fail('O arquivo contém ligações ou ficheiros cifrados.');return;}
   const size=entry.uncompressedSize,compressed=entry.compressedSize;total+=size;
   if(size>15_000_000||total>50_000_000||(size>1_000_000&&(compressed===0||size/compressed>100))){fail('O arquivo excede os limites de descompressão.');return;}
   const name=entry.fileName,lower=name.toLowerCase();const kind=lower.endsWith('.pdf')?'pdf':lower.endsWith('.zip')?'zip':/\.(?:docx|xlsx|pptx)$/.test(lower)?'office':'other';
   entries.push({name,compressedBytes:compressed,uncompressedBytes:size,kind});zip.readEntry();
  });
  zip.on('end',()=>{if(!settled){settled=true;resolve({entries,requiresReview:true});}});zip.readEntry();
 }));
}
