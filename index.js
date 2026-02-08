const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  PermissionsBitField, 
  SlashCommandBuilder, 
  REST, 
  Routes 
} = require('discord.js');
const fs = require('fs');
const express = require('express');

// --- 1. Botの設定 ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent 
  ],
});

// --- 2. データ管理設定 ---
const DATA_FILE = './data.json';
const TRIGGER_FILE = './triggers.json';
const cooldowns = new Map();

function loadJson(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    return file === TRIGGER_FILE ? {} : [];
  } catch (err) { return file === TRIGGER_FILE ? {} : []; }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// --- 3. Webサーバー設定 (これがサイトの正体) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Mania Bot Monitor</title></head>
      <body style="background:#1a1a1a; color:white; font-family:sans-serif; text-align:center; padding-top:50px;">
        <h1 style="color:#7289da;">🤖 Mania Bot is Running</h1>
        <p>Render上でWebサイトとBotが連動して稼働中です。</p>
        <hr style="width:50%; border:1px solid #333;">
        <p>Status: <span style="color:#43b581;">ONLINE</span></p>
        <p>Bot Tag: <strong>${client.user ? client.user.tag : 'Connecting...'}</strong></p>
      </body>
    </html>
  `);
});

// サーバー起動と同時にBotをログインさせる
app.listen(PORT, () => {
  console.log(`✅ [SYSTEM] Web Server Online: Port ${PORT}`);
  
  if (process.env.TOKEN) {
    client.login(process.env.TOKEN).catch(err => {
      console.error("❌ [ERROR] Discordログイン失敗:", err.message);
    });
  } else {
    console.error("❌ [ERROR] TOKENが設定されていません。RenderのEnvironment Variablesを確認してください。");
  }
});

// --- 4. スラッシュコマンド登録 ---
const commands = [
  new SlashCommandBuilder().setName('madd').setDescription('【管理者】パネル用保存').addStringOption(o => o.setName('content').setDescription('内容').setRequired(true)),
  new SlashCommandBuilder().setName('mtrigger').setDescription('【管理者】トリガー設定').addStringOption(o => o.setName('trigger').setDescription('単語').setRequired(true)).addStringOption(o => o.setName('response').setDescription('返信').setRequired(true)),
  new SlashCommandBuilder().setName('mtriggerlist').setDescription('【管理者】一覧表示'),
  new SlashCommandBuilder().setName('mpanel').setDescription('【管理者】パネル表示'),
  new SlashCommandBuilder().setName('mclear').setDescription('【管理者】全削除'),
  new SlashCommandBuilder().setName('mhelp').setDescription('【管理者】ヘルプ'),
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`✅ [BOT] Discord Bot Online: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ [BOT] Slash Commands Registered");
  } catch (error) { console.error(error); }
});

// --- 5. メッセージ（トリガー）処理 ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('m!')) return;

  const word = message.content.replace('m!', '');
  const triggers = loadJson(TRIGGER_FILE);
  if (!triggers[word]) return;

  // 管理者以外にはクールタイム適用
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    const now = Date.now();
    const cooldownAmount = 10000;
    if (cooldowns.has(message.author.id)) {
      const expirationTime = cooldowns.get(message.author.id) + cooldownAmount;
      if (now < expirationTime) {
        const reply = await message.reply(`⏳ あと ${((expirationTime - now) / 1000).toFixed(1)} 秒待ってください。`);
        return setTimeout(() => reply.delete().catch(() => {}), 5000);
      }
    }
    cooldowns.set(message.author.id, now);
    setTimeout(() => cooldowns.delete(message.author.id), cooldownAmount);
  }
  await message.channel.send(triggers[word]);
});

// --- 6. インタラクション（コマンド・ボタン）処理 ---
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand() && !i.isButton()) return;
  
  if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return i.reply({ content: "❌ 管理者権限が必要です。", ephemeral: true });
  }

  if (i.isChatInputCommand()) {
    if (i.commandName === 'mtrigger') {
      const t = i.options.getString('trigger');
      const r = i.options.getString('response');
      const trs = loadJson(TRIGGER_FILE);
      trs[t] = r;
      saveJson(TRIGGER_FILE, trs);
      await i.reply({ content: `✅ m!${t} を登録しました。`, ephemeral: true });
    }
    if (i.commandName === 'mhelp') {
      await i.reply({ content: "### 🛠️ 管理者ヘルプ\n- /mtrigger: 登録\n- /mtriggerlist: 一覧\n- /mpanel: ボタンパネル", ephemeral: true });
    }
    // その他のコマンド処理も必要に応じてここに追加
  }

  if (i.isButton() && i.customId.startsWith('send_msg_')) {
    const index = parseInt(i.customId.split('_')[2]);
    const msgs = loadJson(DATA_FILE);
    if (msgs[index]) {
      await i.channel.send(msgs[index]);
      await i.deferUpdate();
    }
  }
});
