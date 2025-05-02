// Node.js v20 対応：服装ごとに指定枚数生成対応版（index.js）
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import dayjs from "dayjs";
import pLimit from "p-limit";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] === 'prod' ? 'prod' : 'dev';
const configPath = (name) => `./config/${name}.${mode}.json`;

const readJSON = async (relativePath) => {
  const absPath = path.join(__dirname, relativePath);
  const data = await fs.readFile(absPath, "utf-8");
  return JSON.parse(data);
};

function expandPrompt(prompt) {
  return prompt.replace(/\{([^}]+)\}/g, (_, group) => {
    const options = group.split("|");
    return options[Math.floor(Math.random() * options.length)];
  });
}

const generateImage = async (i, clothingPrompt, env, setting, prompts, payloadConfig, adetailerDefaults) => {
  console.log(`${i}枚目の画像を生成中（服装: ${clothingPrompt}）...`);
  try {
    const hair = expandPrompt(prompts.HairPrompt);
    const face = expandPrompt(prompts.FaceExpressionPrompt);
    const pose = expandPrompt(prompts.PosePrompt);
    const person = expandPrompt(prompts.PersonPrompt);
    const basePrompt = prompts.BasePrompt;
    const negativePrompt = prompts.NegativePrompt;

    const fullPrompt = [basePrompt, face, hair, pose, person, clothingPrompt].join(", \n\n");
    const personName = person.match(/<lora:(.*?):/)[1];
    const timestamp = dayjs().format("YYYYMMDD-HHmmss");
    const dir = path.join(env.output_dir, personName);
    const filename = path.join(dir, `${timestamp}-${i}.png`);
    const adetailerPrompt = `${face}, ${person}`;

    await fs.mkdir(dir, { recursive: true });

    const payload = {
      ...payloadConfig,
      prompt: fullPrompt,
      negative_prompt: negativePrompt,
      alwayson_scripts: {
        ADetailer: {
          args: [
            true,
            false,
            {
              ...adetailerDefaults,
              ad_prompt: adetailerPrompt
            }
          ]
        }
      }
    };

    const res = await axios.post(env.api_url, payload);
    const imageBase64 = res.data.images[0];
    const buffer = Buffer.from(imageBase64, 'base64');
    await fs.writeFile(filename, buffer);
    console.log(`✅ ${i}枚目の画像を生成しました: ${filename}`);

  } catch (err) {
    console.error(`❌ Error generating image ${i + 1}:`, err.message);
  }
};

const main = async () => {
  const env = await readJSON(configPath("env"));
  const setting = await readJSON(configPath("setting"));
  const prompts = await readJSON(configPath("prompts"));
  const payloadConfig = await readJSON(configPath("payload"));
  const adetailerDefaults = await readJSON(configPath("adetailer"));
  const clothingList = await readJSON(configPath("clothingPrompt"));

  const limit = pLimit(setting.concurrency);
  const tasks = [];

  for (const clothingPrompt of clothingList) {
    for (let i = 0; i < setting.total_images; i++) {
      tasks.push(limit(() => generateImage(i, clothingPrompt, env, setting, prompts, payloadConfig, adetailerDefaults)));
    }
  }

  await Promise.all(tasks);
};

main();
