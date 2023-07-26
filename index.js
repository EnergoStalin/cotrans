import fs from "fs";
import FormData from "form-data";
import { Axios } from "axios";
import path from "path";
import pLimit from "p-limit";
import https from "https";

const limit4 = pLimit(4);
const axios = new Axios({
  headers: {"Bypass-Tunnel-Reminder": "bypass"},
  httpsAgent: new https.Agent({ keepAlive: true })
})

class TranslateConfig {
  constructor(file, size, detector, direction, translator, tgt_lang) {
    this.file = file;
    this.size = size || "L";
    this.detector = detector || "auto";
    this.direction = direction || "h";
    this.translator = translator || "google";
    this.tgt_lang = tgt_lang || "RUS";
  }
}

class CortransApi {
  constructor(apiUrl, resultsUrl) {
    this.apiUrl = apiUrl;
    this.resultsUrl = resultsUrl;
  }

  downloadFinal(taskId, dest) {
    return new Promise(async (res, rej) => {
      const writer = fs.createWriteStream(dest);
      writer.on('error', rej);
      writer.on('close', () => res(dest));

      const downloadUrl = `${this.resultsUrl}/${taskId}/final.jpg`;
      (await axios.get(downloadUrl, {
        responseType: "stream"
      })).data.pipe(writer);
    })
  }

  /**
   * @param {TranslateConfig} tc 
   */
  async submitTranslate(tc) {
    const data = new FormData();

    data.append("file", fs.createReadStream(tc.file));
    data.append("size", tc.size);
    data.append("detector", tc.detector);
    data.append("direction", tc.direction);
    data.append("translator", tc.translator);
    data.append("tgt_lang", tc.tgt_lang);

    return JSON.parse((await axios.post(`${this.apiUrl}/submit`, data)).data)
  }

  async taskState(taskId) {
    return JSON.parse((await axios.get(`${this.apiUrl}/task-state?taskid=${taskId}`)).data);
  }
}


async function* walk(dir) {
  for await (const d of await fs.promises.opendir(dir)) {
      const entry = path.join(dir, d.name);
      if (d.isDirectory()) yield* walk(entry);
      else if (d.isFile()) yield entry;
  }
}

async function translate(f, out) {
  console.log(`Queueing ${f}...`);
  const task = await cotrans.submitTranslate(new TranslateConfig(f));
  console.log(`Queued ${f} => ${task.task_id}`);

  let state = null;
  while(true) {
    state = (await cotrans.taskState(task.task_id)).state
    console.log(`Status ${task.task_id} => ${state}`);
    if (state === "saved") break;
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`Downloading ${task.task_id}`)
  const file = await cotrans.downloadFinal(task.task_id, out);
  console.log(`Downloaded ${task.task_id} => ${file}`)
  console.log(`Deleting original...`)
  fs.rmSync(f);
}

const argc = process.argv.length - 2;
if(argc !== 2) {
  console.log(`Wrong number of args ${argc} != 2`);
  process.exit(1);
}

console.log(`Initializing Cotrans with API url: ${process.argv[2]}, Results url: ${process.argv[3]}`);
const cotrans = new CortransApi(process.argv[2], process.argv[3]);

const root = "in";
const files = [];
for await(const entry of walk(root)) {
  if(![".png", ".jpg"].includes(path.extname(entry))) continue;
  files.push(entry);
}

await Promise.all(files.map(f => {
  const fn = f.replace(root, "./out");
  fs.mkdirSync(path.dirname(fn), { recursive: true });

  return limit4(() => translate(f, fn))
}))
