# -*- coding: utf-8 -*-
"""
Contribuicao Ajuste: executa Ajuste 01 ou Ajuste 06/275 conforme opcao.
Digite 1 ou 6 para escolher o ajuste; em seguida informe quantos ciclos.
Interrupcao: CTRL + ALT + ESC
"""
import pyautogui
import time
import keyboard
import threading

interromper = False


def checar_interrupcao():
    global interromper
    while True:
        if keyboard.is_pressed('ctrl') and keyboard.is_pressed('alt') and keyboard.is_pressed('esc'):
            print("Interrupcao detectada (CTRL + ALT + ESC). Encerrando o processo...")
            interromper = True
            break
        time.sleep(0.1)


def executar_ciclo_01():
    global interromper
    print("Iniciando ciclo (Ajuste 01)...")
    pyautogui.press('f3')
    time.sleep(0.5)
    if interromper:
        return
    pyautogui.press('enter', presses=18, interval=0.01)
    if interromper:
        return
    pyautogui.write('01')
    pyautogui.press('enter', presses=2, interval=0.01)
    if interromper:
        return
    pyautogui.write('01')
    pyautogui.press('enter', presses=2, interval=0.01)
    if interromper:
        return
    pyautogui.press('f9')
    time.sleep(0.5)
    if interromper:
        return
    print("Ciclo finalizado.\n")


def executar_ciclo_06():
    global interromper
    print("Iniciando ciclo (Ajuste 06/275)...")
    pyautogui.press('f3')
    time.sleep(1.0)
    if interromper:
        return
    pyautogui.press('enter', presses=20, interval=0.01)
    if interromper:
        return
    pyautogui.write('06')
    pyautogui.press('enter', presses=2, interval=0.01)
    pyautogui.write('275')
    pyautogui.press('enter')
    if interromper:
        return
    pyautogui.write('06')
    pyautogui.press('enter', presses=2, interval=0.01)
    pyautogui.write('275')
    pyautogui.press('enter')
    if interromper:
        return
    pyautogui.press('f9')
    time.sleep(1.0)
    if interromper:
        return
    print("Ciclo finalizado.\n")


def main():
    global interromper
    try:
        print("Qual ajuste deseja executar?")
        print("  1 - Ajuste 01")
        print("  6 - Ajuste 06/275")
        opcao = input("Digite 1 ou 6: ").strip()
        if opcao not in ('1', '6'):
            print("Opcao invalida. Use 1 ou 6.")
            return

        num_ciclos = int(input("Digite o numero de ciclos a executar: "))
        if num_ciclos <= 0:
            print("Numero invalido.")
            return

        executar_ciclo = executar_ciclo_01 if opcao == '1' else executar_ciclo_06
        nome_ajuste = "Ajuste 01" if opcao == '1' else "Ajuste 06/275"
        print(f"\nModo: {nome_ajuste} | Ciclos: {num_ciclos}")
        print("Voce tem 5 segundos para posicionar a janela correta...")
        time.sleep(5)

        listener = threading.Thread(target=checar_interrupcao, daemon=True)
        listener.start()

        intervalo_down = 0.1 if opcao == '1' else 0.5
        for i in range(num_ciclos):
            if interromper:
                break
            print(f"Executando ciclo {i+1} de {num_ciclos}")
            executar_ciclo()
            if interromper:
                break
            pyautogui.press('down')
            time.sleep(intervalo_down)

        if interromper:
            print("Processo interrompido pelo usuario.")
        else:
            print("Todos os ciclos foram executados.")
            pyautogui.press('f9')

    except ValueError:
        print("Digite um numero inteiro valido para os ciclos.")
    except Exception as e:
        print(f"Ocorreu um erro: {e}")


if __name__ == "__main__":
    main()
