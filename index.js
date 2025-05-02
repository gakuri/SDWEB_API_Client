// Node.js v20 対応：画像をjpgに変換して日付フォルダに保存（index.js）
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import dayjs from "dayjs";
import pLimit from "p-limit";
import { fileURLToPath } from 'url';
import sharp from "sharp";

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

const generateImage = async (index, env, setting, prompts, clothingPrompt, payloadConfig, adetailerDefaults) => {
  console.log(`${index}枚目の画像を生成中...`);
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
    const dayFolder = dayjs().format("YYYYMMDD");

    const tmpDir = path.join(env.output_dir, personName);
    const jpgDir = path.join(env.output_dir, dayFolder);
    const tmpFilename = path.join(tmpDir, `${timestamp}-${index}.png`);
    const jpgFilename = path.join(jpgDir, `${personName}-${timestamp}-${index}.jpg`);
    const adetailerPrompt = `${face}, ${person}`;

    await fs.mkdir(tmpDir, { recursive: true });
    await fs.mkdir(jpgDir, { recursive: true });

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
    await fs.writeFile(tmpFilename, buffer);

    // JPEG変換と保存
    await sharp(buffer).jpeg({ quality: 90 }).toFile(jpgFilename);

    console.log(`✅ ${index}枚目: 保存 -> ${tmpFilename}（png） / ${jpgFilename}（jpg）`);

  } catch (err) {
    console.error(`❌ Error generating image ${index + 1}:`, err.message);
  }
};

const main = async () => {
  const env = await readJSON(configPath("env"));
  const setting = await readJSON(configPath("setting"));
  const prompts = await readJSON(configPath("prompts"));
  const clothingList = await readJSON(configPath("clothingPrompt"));
  const payloadConfig = await readJSON(configPath("payload"));
  const adetailerDefaults = await readJSON(configPath("adetailer"));

  const limit = pLimit(setting.concurrency);
  const tasks = [];
  let globalIndex = 0;

  for (const clothingPrompt of clothingList) {
    for (let i = 0; i < setting.total_images; i++) {
      const currentIndex = globalIndex++;
      tasks.push(limit(() => generateImage(currentIndex, env, setting, prompts, clothingPrompt, payloadConfig, adetailerDefaults)));
    }
  }

  await Promise.all(tasks);
};

main();
