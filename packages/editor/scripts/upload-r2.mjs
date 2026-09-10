import {initDir, sh} from "./utils.mjs";
import * as fs from "node:fs";

initDir()

const source = process.argv[2];
const dest = (process.argv[3]).replace(/\/$/,'');
// if(!process.env.CFR2_WEBSITE_BUCKET_NAME){
//     console.error('CFR2_WEBSITE_BUCKET_NAME not set in the env.');
//     process.exit(1);
// }
// check for .rclone.conf file
if(process.env.RCLONE_CONFIG){
    console.error('RCLONE_CONFIG is already set');
    process.exit(1);
}

const configPath = process.argv[4] || './.rclone.conf'
// check if file exists
if(!fs.existsSync(configPath)){
    console.error('Config file not found at', configPath);
    process.exit(1);
}
// set env
process.env.RCLONE_CONFIG = configPath;

sh(`rm -rf build`);
sh(`npm run build`);
sh(`rm -f dist/.DS_Store`);

// todo: ignore .map, dsstore etc files files?

sh(`echo Uploading ${source} to ${dest}/`);
sh(`npx rclone sync ${source} depl:${dest}/ --exclude="versions/**" --verbose`)

sh(`echo Uploading ${source} to ${dest}/versions/$npm_package_version/`);
sh(`npx rclone sync ${source} depl:${dest}/versions/$npm_package_version/ --verbose`)

sh(`echo Done`);
