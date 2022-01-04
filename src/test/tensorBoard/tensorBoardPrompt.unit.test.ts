import { anything, instance, mock, verify, when } from 'ts-mockito';
import { ApplicationShell } from '../../client/common/application/applicationShell';
import { CommandManager } from '../../client/common/application/commandManager';
import { Commands } from '../../client/common/constants';
import { PersistentState, PersistentStateFactory } from '../../client/common/persistentState';
import { Common } from '../../client/common/utils/localize';
import { TensorBoardEntrypointTrigger } from '../../client/tensorBoard/constants';
import { TensorBoardPrompt } from '../../client/tensorBoard/tensorBoardPrompt';

suite('TensorBoard prompt', () => {
    let applicationShell: ApplicationShell;
    let commandManager: CommandManager;
    let persistentState: PersistentState<boolean>;
    let persistentStateFactory: PersistentStateFactory;
    let prompt: TensorBoardPrompt;

    async function setupPromptWithOptions(persistentStateValue = true, selection = 'Yes') {
        applicationShell = mock(ApplicationShell);
        when(applicationShell.showInformationMessage(anything(), anything(), anything(), anything())).thenReturn(
            Promise.resolve(selection),
        );

        commandManager = mock(CommandManager);
        when(commandManager.executeCommand(Commands.LaunchTensorBoard, anything(), anything())).thenResolve();

        persistentStateFactory = mock(PersistentStateFactory);
        persistentState = mock(PersistentState) as PersistentState<boolean>;
        when(persistentState.value).thenReturn(persistentStateValue);
        when(persistentState.updateValue(anything())).thenResolve();
        when(persistentStateFactory.createWorkspacePersistentState<boolean>(anything(), anything())).thenReturn(
            instance(persistentState),
        );

        prompt = new TensorBoardPrompt(
            instance(applicationShell),
            instance(commandManager),
            instance(persistentStateFactory),
        );
        await prompt.showNativeTensorBoardPrompt(TensorBoardEntrypointTrigger.palette);
    }

    test('Show prompt if user is in experiment, and prompt has not previously been disabled or shown', async () => {
        await setupPromptWithOptions();
        verify(applicationShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
        verify(commandManager.executeCommand(Commands.LaunchTensorBoard, anything(), anything())).once();
    });

    test('Disable prompt if user selects "Do not show again"', async () => {
        await setupPromptWithOptions(true, Common.doNotShowAgain());
        verify(persistentState.updateValue(false)).once();
    });

    test('Do not show prompt if user has previously disabled prompt', async () => {
        await setupPromptWithOptions(false);
        verify(applicationShell.showInformationMessage(anything(), anything(), anything(), anything())).never();
        verify(commandManager.executeCommand(Commands.LaunchTensorBoard, anything(), anything())).never();
    });

    test('Do not show prompt more than once per session', async () => {
        await setupPromptWithOptions();
        verify(applicationShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
        await prompt.showNativeTensorBoardPrompt(TensorBoardEntrypointTrigger.palette);
        verify(applicationShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
    });
});
