import fs from 'node:fs';
import {T5Tokenizer} from '@huggingface/transformers';
const json=JSON.parse(fs.readFileSync(new URL('./tokenizer.json',import.meta.url)));
const tokenizer=new T5Tokenizer(json,{model_max_length:64,pad_token:'<pad>',eos_token:'</s>',unk_token:'<unk>'});
const prompt=process.argv.slice(2).join(' ') || 'A single glass bottle shattering on concrete, isolated sound effect';
const t=tokenizer(prompt,{padding:'max_length',truncation:true,max_length:64});
fs.writeFileSync(new URL('./inputs.json',import.meta.url),JSON.stringify({prompt,ids:Array.from(t.input_ids.data,Number),mask:Array.from(t.attention_mask.data,Number)}));
console.log('tokenized',t.input_ids.dims);
