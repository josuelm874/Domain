import pyautogui
import time
import keyboard
import threading
import pyperclip

interromper = False

def checar_interrupcao():
    global interromper
    while True:
        if keyboard.is_pressed('ctrl') and keyboard.is_pressed('alt') and keyboard.is_pressed('esc'):
            print("\n🔴 Interrupção detectada (CTRL + ALT + ESC). Encerrando o processo...")
            interromper = True
            break
        time.sleep(0.1)

def executar_ciclo():
    global interromper

    print("➡️ Iniciando ciclo...")

    pyautogui.press('f3')
    time.sleep(0.5)
    if interromper: return

    pyautogui.press('enter', presses=13, interval=0.01)
    if interromper: return

    pyautogui.write('06')
    pyautogui.press('enter', presses=2, interval=0.01)
    pyautogui.write('275')
    pyautogui.press('enter')
    if interromper: return

    pyautogui.write('06')
    pyautogui.press('enter', presses=2, interval=0.01)
    pyautogui.write('275')
    pyautogui.press('enter')
    if interromper: return

    pyautogui.press('f9')
    time.sleep(0.5)
    if interromper: return

    print("✅ Ciclo finalizado.\n")

def main():
    global interromper
    try:
        num_ciclos = int(input("Digite o número de ciclos a executar: "))
        if num_ciclos <= 0:
            print("❌ Número inválido.")
            return

        print("⏳ Você tem 5 segundos para posicionar a janela correta...")
        time.sleep(5)

        listener = threading.Thread(target=checar_interrupcao, daemon=True)
        listener.start()

        for i in range(num_ciclos):
            if interromper:
                break
            print(f"🔁 Executando ciclo {i+1} de {num_ciclos}")
            executar_ciclo()
            if interromper:
                break
            pyautogui.press('down')
            time.sleep(0.1)

        if interromper:
            print("🛑 Processo interrompido pelo usuário.")
        else:
            print("✅ Todos os ciclos foram executados.")
            pyautogui.press('f9')

    except Exception as e:
        print(f"❌ Ocorreu um erro: {e}")

if __name__ == "__main__":
    main()

