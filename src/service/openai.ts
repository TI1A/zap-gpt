// Importando módulos necessários
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

// Configurando variáveis de ambiente
dotenv.config();

// Variáveis globais para armazenar instância da OpenAI e chats ativos
let assistant: OpenAI.Beta.Assistants.Assistant;
let openai: OpenAI;
const activeChats = new Map();

// Função para inicializar uma nova sessão de chat com a OpenAI
export async function initializeNewAIChatSession(
  chatId: string
): Promise<void> {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY,
  });
  assistant = await openai.beta.assistants.retrieve(
    process.env.OPENAI_ASSISTANT!
  );
  if (activeChats.has(chatId)) return;
  const thread = await openai.beta.threads.create();
  activeChats.set(chatId, thread);
}

// Função para interagir com o assistente da OpenAI
export async function handleUserInput({
  userInput,
  chatId,
}: {
  userInput: string | Buffer; // userInput pode ser texto ou áudio
  chatId: string;
}): Promise<string | void> {
  if (typeof userInput === 'string') {
    // Se o userInput for texto
    return await handleTextMessage(userInput, chatId);
  } else if (Buffer.isBuffer(userInput)) {
    // Se o userInput for um buffer de áudio
    return await handleAudioMessage(userInput, chatId);
  } else {
    // Caso contrário, não faz nada
    console.log('Tipo de entrada não suportado.');
  }
}

// Função para lidar com mensagens de texto
async function handleTextMessage(
  textMessage: string,
  chatId: string
): Promise<string> {
  const thread = activeChats.get(chatId) as OpenAI.Beta.Threads.Thread;
  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: textMessage,
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id,
    instructions: assistant.instructions,
  });

  const messages = await checkRunStatus({ threadId: thread.id, runId: run.id });
  const responseAI = messages.data[0]
    .content[0] as OpenAI.Beta.Threads.Messages.MessageContentText;
  return responseAI.text.value;
}

// Função para lidar com mensagens de áudio
async function handleAudioMessage(
  audioData: Buffer,
  chatId: string
): Promise<void> {
  // Criando um arquivo temporário para armazenar o áudio
  const tempAudioFilePath = path.join(__dirname, 'temp_audio.mp3');
  fs.writeFileSync(tempAudioFilePath, audioData);

  // Convertendo o áudio em texto usando a função do Whisper
  const transcription = await convertAudioToText(tempAudioFilePath);

  // Enviando a transcrição para o assistente e obtendo a resposta
  const responseText = await handleTextMessage(transcription, chatId);

  // Convertendo a resposta do assistente em áudio usando a função do Alloyvoz
  const audioResponse = await generateSpeechFromText(responseText, 'output.mp3');

  // Removendo o arquivo temporário de áudio
  fs.unlinkSync(tempAudioFilePath);
}

// Função para verificar o status de uma execução
async function checkRunStatus({
  threadId,
  runId,
}: {
  threadId: string;
  runId: string;
}): Promise<OpenAI.Beta.Threads.Messages.ThreadMessagesPage> {
  return await new Promise((resolve, _reject) => {
    const verify = async (): Promise<void> => {
      const runStatus = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
      );

      if (runStatus.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(threadId);
        resolve(messages);
      } else {
        console.log('Aguardando resposta da OpenAI...');
        setTimeout(verify, 3000);
      }
    };

    verify();
  });
}

// Função para converter áudio em texto
async function convertAudioToText(
  audioFilePath: string
): Promise<string> {
  const client = new OpenAI();

  // Lendo o arquivo de áudio como um fluxo
  const audioStream = fs.createReadStream(audioFilePath);

  // Criando um objeto ReadableStream a partir do fluxo de áudio
  const readableStream = new Readable({
    read() {
      this.push(audioStream.read());
    },
  });

  // Enviando o áudio para a OpenAI para transcrição
  const response = await client.audio.transcriptions.create({
    model: 'whisper-1', // Usando modelo de transcrição padrão
    file: readableStream, // Passando o fluxo de áudio como entrada
  });

  // Retornando o texto transcritor
  return response.text;
}

// Função para gerar áudio a partir de texto usando a API de áudio da OpenAI
async function generateSpeechFromText(
  text: string,
  outputFileName: string
): Promise<void> {
  const client = new OpenAI(); // Criando uma nova instância do cliente OpenAI

  const speechFilePath = path.join(__dirname, outputFileName); // Caminho do arquivo de áudio de saída

  const response = await client.audio.speech.create({
    model: 'tts-1', // Modelo TTS padrão
    voice: 'alloy', // Voz para geração do áudio
    input: text, // Texto de entrada para conversão em áudio
  }); // Criando áudio a partir do texto fornecido

  const outputStream = fs.createWriteStream(speechFilePath); // Criando fluxo de saída para o arquivo de áudio
  response.stream().pipe(outputStream); // Transmitindo áudio para o arquivo

  await new Promise((resolve) => {
    outputStream.on('finish', resolve); // Resolvendo a promessa quando a escrita do arquivo estiver concluída
  });
}
