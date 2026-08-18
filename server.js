const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const puppeteer = require('puppeteer');

// ================= Configurações =================
const API_URL = 'https://kirontech.com.br/api/dashboard/stats.php';
const TARGET_NUMBER = '5579998781719@c.us'; // Número de destino com o sufixo do WhatsApp
const PORT = process.env.PORT || 3000;

// Variável para armazenar a quantidade de notificações conhecidas
let lastKnownNotifications = null;

// ================= Servidor Express (Para o Render) =================
const app = express();
app.get('/', (req, res) => {
    res.send('Robô Sentinela do WhatsApp está rodando!');
});

app.listen(PORT, () => {
    console.log(`Servidor Express rodando na porta ${PORT}`);
});

// ================= WhatsApp Client =================
const client = new Client({
    authStrategy: new LocalAuth(), // Salva a sessão localmente na pasta .wwebjs_auth
    puppeteer: {
        executablePath: puppeteer.executablePath(),
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Necessário para rodar em servidores como o Render
    }
});

client.on('qr', (qr) => {
    console.log('*** ESCANEIE O QR CODE ABAIXO COM O SEU WHATSAPP ***');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Cliente do WhatsApp conectado com sucesso!');
    
    // Inicia o job de monitoramento
    iniciarMonitoramento();
});

client.on('auth_failure', msg => {
    console.error('Falha na autenticação do WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
});

client.initialize();

// ================= Lógica do Robô =================
function iniciarMonitoramento() {
    console.log('Iniciando monitoramento da API a cada 1 minuto...');
    
    // Verifica imediatamente ao iniciar
    checarNotificacoes();

    // Configura o cron para rodar a cada 1 minuto
    cron.schedule('* * * * *', () => {
        checarNotificacoes();
    });
}

async function checarNotificacoes() {
    try {
        console.log(`[${new Date().toISOString()}] Checando notificações na Kirontech...`);
        const response = await axios.get(API_URL);
        
        if (response.data && response.data.success && response.data.systems) {
            const systems = response.data.systems;
            
            // Soma todas as notificações de todos os sistemas
            let totalNotifications = 0;
            systems.forEach(sys => {
                // A API mapeou 'support_notifications' para 'notifications'
                totalNotifications += parseInt(sys.notifications || 0, 10);
            });
            
            console.log(`Total de notificações atuais: ${totalNotifications}`);

            if (lastKnownNotifications === null) {
                // Primeira execução: apenas registra o estado atual
                console.log(`Estado inicial registrado: ${totalNotifications} notificações.`);
                lastKnownNotifications = totalNotifications;
                return;
            }

            if (totalNotifications > lastKnownNotifications) {
                const dif = totalNotifications - lastKnownNotifications;
                console.log(`Aumento detectado! ${dif} nova(s) notificação(ões). Enviando WhatsApp...`);
                
                const mensagem = `🚨 *Sentinela Kirontech* 🚨\n\nFoi detectada uma nova movimentação no sistema!\nNovas notificações: *${dif}*\nTotal de notificações pendentes: *${totalNotifications}*\n\nAcesse o painel Control_SADMIN para verificar.`;
                
                await client.sendMessage(TARGET_NUMBER, mensagem);
                console.log('Mensagem enviada com sucesso!');
                
                lastKnownNotifications = totalNotifications;
            } else if (totalNotifications < lastKnownNotifications) {
                // Se o número diminuiu, significa que alguém atendeu as notificações
                console.log('O número de notificações diminuiu (foram atendidas). Atualizando contador interno.');
                lastKnownNotifications = totalNotifications;
            }
        }
    } catch (error) {
        console.error('Erro ao buscar dados da API:', error.message);
    }
}
