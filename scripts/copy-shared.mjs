// Functions deploy only uploads functions/, so copy the shared scoring code in.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('functions/shared', { recursive: true });
cpSync('shared', 'functions/shared', { recursive: true });
console.log('copied shared/ -> functions/shared/');
