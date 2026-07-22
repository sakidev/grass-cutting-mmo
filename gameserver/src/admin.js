// Process inputs of the nodejs app so that I can run
// admin commands from the terminal
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on('line', (input) => {
    const args = input.split(" ");
    const command = args[0];
    switch(command)
    {
        case "createRankedGame":
            {
                const entryFee = parseFloat(args[1]) || 1.00;
                console.log("Creating ranked game with entry fee:", entryFee);
                global.main.oracle.createRankedGame(entryFee);
            }
            break;
        default:
            console.log("Unknown command", command);
            break;
    }
});