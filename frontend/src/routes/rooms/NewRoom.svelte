<script lang="ts">
    async function create_room() {
        let generatedID = await fetch("/api/create-room");
        generatedID
            .text()
            .then((roomCode) => window.location.replace(`#/room/${roomCode}`));
    }
    $effect(() => {
        create_room();
    });
</script>
