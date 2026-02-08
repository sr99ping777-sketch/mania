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
const keepAlive = require('./keep_alive.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent 
  ],
});

const DATA_FILE = './data.json';
const TRIGGER_FILE = './triggers.json';

// クールダウン管理用マップ (ユーザーID: 次回使用可能時刻)
const cooldowns = new Map();

function loadJson(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    return file === TRIGGER_FILE ? {} : [];
  } catch (err) { return file === TRIGGER_FILE ? {} : []; }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// --- コマンド定義 ---
const commands = [
  new SlashCommandBuilder()
    .setName('madd')
    .setDescription('【管理者】パネル用メッセージを保存します')
    .addStringOption(option => option.setName('content').setDescription('内容').setRequired(true)),
  new SlashCommandBuilder()
    .setName('mtrigger')
    .setDescription('【管理者】自動応答トリガーを設定します')
    .addStringOption(option => option.setName('trigger').setDescription('反応する単語').setRequired(true))
    .addStringOption(option => option.setName('response').setDescription('返信する内容').setRequired(true)),
  new SlashCommandBuilder()
    .setName('mtriggerlist')
    .setDescription('【管理者】登録されているトリガーの一覧を表示します'),
  new SlashCommandBuilder()
    .setName('mpanel')
    .setDescription('【管理者】送信パネルを表示します'),
  new SlashCommandBuilder()
    .setName('mclear')
    .setDescription('【管理者】全てのデータを削除します'),
  new SlashCommandBuilder()
    .setName('mhelp')
    .setDescription('【管理者】使い方を表示します'),
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} 起動完了`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  } catch (error) { console.error(error); }
});

// --- メッセージ受信処理 (クールダウン付きトリガー) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('m!')) {
    const word = message.content.replace('m!', '');
    const triggers = loadJson(TRIGGER_FILE);

    if (!triggers[word]) return;

    // 管理者はクールダウン免除
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const now = Date.now();
      const cooldownAmount = 10 * 1000; // 10秒

      if (cooldowns.has(message.author.id)) {
        const expirationTime = cooldowns.get(message.author.id) + cooldownAmount;

        if (now < expirationTime) {
          const timeLeft = (expirationTime - now) / 1000;
          const reply = await message.reply({ 
            content: `⏳ クールダウン中です。あと ${timeLeft.toFixed(1)} 秒待ってください。` 
          });
          // 5秒後に警告メッセージを消す (チャットを汚さないため)
          setTimeout(() => reply.delete().catch(() => {}), 5000);
          return;
        }
      }
      // クールダウン時間をセット
      cooldowns.set(message.author.id, now);
      // 10秒後にクールダウンリストから削除（メモリ節約）
      setTimeout(() => cooldowns.delete(message.author.id), cooldownAmount);
    }

    // トリガー送信
    await message.channel.send(triggers[word]);
  }
});

// --- インタラクション処理 (管理者のみ) ---
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand() || interaction.isButton()) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "❌ 管理者権限が必要です。", ephemeral: true });
    }
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'mhelp') {
      const helpText = `
### 🛠️ 管理者ボット 総合ヘルプ
**1. パネル機能**
* \`/madd\`, \`/mpanel\`
**2. 自動応答 (クールダウン10秒)**
* \`/mtrigger\`, \`/mtriggerlist\`
**3. その他**
* \`/mclear\`
      `;
      return interaction.reply({ content: helpText, ephemeral: true });
    }

    if (interaction.commandName === 'mtrigger') {
      const trigger = interaction.options.getString('trigger');
      const response = interaction.options.getString('response');
      const triggers = loadJson(TRIGGER_FILE);
      triggers[trigger] = response;
      saveJson(TRIGGER_FILE, triggers);
      await interaction.reply({ content: `✅ トリガー「m!${trigger}」を登録しました。`, ephemeral: true });
    }

    if (interaction.commandName === 'mtriggerlist') {
      const triggers = loadJson(TRIGGER_FILE);
      const keys = Object.keys(triggers);
      if (keys.length === 0) return interaction.reply({ content: "❌ 登録なし", ephemeral: true });
      let listText = "### 📋 登録済みトリガー一覧\n";
      keys.forEach(key => listText += `• **m!${key}** → ${triggers[key]}\n`);
      await interaction.reply({ content: listText, ephemeral: true });
    }

    if (interaction.commandName === 'madd') {
      const content = interaction.options.getString('content');
      const messages = loadJson(DATA_FILE);
      messages.push(content);
      saveJson(DATA_FILE, messages);
      await interaction.reply({ content: `✅ 保存完了 (${messages.length}個)`, ephemeral: true });
    }

    if (interaction.commandName === 'mclear') {
      saveJson(DATA_FILE, []);
      saveJson(TRIGGER_FILE, {});
      await interaction.reply({ content: "🗑️ 全削除完了", ephemeral: true });
    }

    if (interaction.commandName === 'mpanel') {
      const messages = loadJson(DATA_FILE);
      if (messages.length === 0) return interaction.reply({ content: "❌ データなし", ephemeral: true });
      const rows = [];
      let currentRow = new ActionRowBuilder();
      messages.forEach((msg, index) => {
        if (index % 5 === 0 && index > 0) {
          rows.push(currentRow);
          currentRow = new ActionRowBuilder();
        }
        const labelName = msg.length > 4 ? msg.substring(0, 4) + "..." : msg;
        currentRow.addComponents(new ButtonBuilder().setCustomId(`send_msg_${index}`).setLabel(labelName).setStyle(ButtonStyle.Primary));
      });
      rows.push(currentRow);
      await interaction.reply({ content: "🛠️ **管理者パネル**", components: rows, ephemeral: true });
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('send_msg_')) {
    const index = parseInt(interaction.customId.split('_')[2]);
    const messages = loadJson(DATA_FILE);
    if (messages[index]) {
      await interaction.channel.send(messages[index]);
      await interaction.deferUpdate(); 
    }
  }
});

keepAlive();
client.login(process.env.TOKEN);
    // 保存