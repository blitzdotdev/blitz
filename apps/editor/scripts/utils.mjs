import path from "node:path";
import { execSync } from 'node:child_process';

export function initDir(root = '/../'){
    const __dirname = path.dirname(new URL(import.meta.url).pathname)
    // make sure current working directory is the root of the project
    process.chdir(path.join(__dirname, root))
    const cwd = process.cwd()
    // print the current working directory
    console.log("Running Script in", cwd)
    return cwd
}

export function sh(cmd){
    return execSync(cmd, {stdio: 'inherit'});
}

export function replacePlistValue(plist, key, value) {
    return plist.replace(new RegExp(`(<key>${key}<\\/key>\\s*<string>)([^<]*)(<\\/string>)`), `$1${value}$3`)
}
export function replacePlistValues(plist, obj) {
    return Object.entries(obj).reduce((plist, [key, value]) => replacePlistValue(plist, key, value), plist)
}
